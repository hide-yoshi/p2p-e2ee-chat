import { chromium, type Page } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const ADDR_A = '0xaaaa000000000000000000000000000000001111';
const ADDR_B = '0xbbbb000000000000000000000000000000002222';

function makeEthereumMock(address: string) {
  return `
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '${address}',
      chainId: '0x1',
      networkVersion: '1',
      isConnected: () => true,
      request: async ({ method }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return ['${address}'];
          case 'eth_chainId':
            return '0x1';
          case 'net_version':
            return '1';
          case 'personal_sign':
            return '0x' + 'ab'.repeat(65);
          case 'eth_signTypedData_v4':
            return '0x' + 'ab'.repeat(65);
          default:
            return null;
        }
      },
      on: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      emit: () => {},
    };
  `;
}

async function ss(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`    ss: ${name}.png`);
}

async function connectWallet(page: Page, label: string): Promise<void> {
  console.log(`  [${label}] Connecting wallet...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('button').filter({ hasText: /connect wallet/i }).click();
  await page.waitForTimeout(5000);
  const text = (await page.locator('#root').textContent())?.toLowerCase() ?? '';
  if (!text.includes('contact') && !text.includes('node') && !text.includes('waku')) {
    throw new Error(`[${label}] Failed to enter chat UI: ${text.substring(0, 100)}`);
  }
  console.log(`  [${label}] Chat UI loaded`);
}

async function waitForWaku(page: Page, label: string, timeoutMs = 60000): Promise<boolean> {
  console.log(`  [${label}] Waiting for Waku to connect...`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = (await page.locator('#root').textContent())?.toLowerCase() ?? '';
    if (text.includes('waku connected')) {
      console.log(`  [${label}] Waku connected (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return true;
    }
    await page.waitForTimeout(2000);
  }
  console.log(`  [${label}] Waku connection timed out`);
  return false;
}

async function test() {
  console.log('=== P2P E2EE Chat (Waku + X3DH) - E2E Test ===\n');

  const browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await contextA.addInitScript(makeEthereumMock(ADDR_A));
  await contextB.addInitScript(makeEthereumMock(ADDR_B));

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const logsA: string[] = [];
  const logsB: string[] = [];
  pageA.on('console', (msg) => logsA.push(`[A:${msg.type()}] ${msg.text()}`));
  pageB.on('console', (msg) => logsB.push(`[B:${msg.type()}] ${msg.text()}`));
  pageA.on('pageerror', (err) => logsA.push(`[A:pageerror] ${err.message}`));
  pageB.on('pageerror', (err) => logsB.push(`[B:pageerror] ${err.message}`));

  // ===== STEP 1: Connect wallets =====
  console.log('STEP 1: Connect wallets');
  await connectWallet(pageA, 'A');
  await ss(pageA, 'waku-01-A-connected');
  await connectWallet(pageB, 'B');
  await ss(pageB, 'waku-01-B-connected');
  console.log('');

  // ===== STEP 2: Wait for Waku =====
  console.log('STEP 2: Wait for Waku connection');
  const wakuA = await waitForWaku(pageA, 'A', 90000);
  await ss(pageA, 'waku-02-A-waku-status');
  const wakuB = await waitForWaku(pageB, 'B', 90000);
  await ss(pageB, 'waku-02-B-waku-status');
  console.log('');

  if (!wakuA || !wakuB) {
    console.log('  Waku failed to connect. Checking page errors...');
    const errA = logsA.filter(l => l.includes('pageerror') || l.includes('[waku]'));
    const errB = logsB.filter(l => l.includes('pageerror') || l.includes('[waku]'));
    errA.forEach(l => console.log(`  ${l}`));
    errB.forEach(l => console.log(`  ${l}`));
    await ss(pageA, 'waku-02-A-debug');
    await ss(pageB, 'waku-02-B-debug');
  }

  // ===== STEP 3: A adds B as contact =====
  console.log('STEP 3: A adds B as contact');
  const addInput = pageA.locator('input[placeholder*="0x"]').first();
  if (await addInput.isVisible().catch(() => false)) {
    await addInput.fill(ADDR_B);
    await pageA.waitForTimeout(500);
    const addBtn = pageA.locator('button').filter({ hasText: /\[add\]/i }).first();
    await addBtn.click();
    console.log('  Clicked add, waiting for X3DH (up to 120s)...');
    // Wait for contact to appear, polling
    let aAdded = false;
    for (let i = 0; i < 60; i++) {
      await pageA.waitForTimeout(2000);
      const t = (await pageA.locator('#root').textContent())?.toLowerCase() ?? '';
      if (t.includes('bbbb') && t.includes('contacts [1]')) {
        aAdded = true;
        break;
      }
    }
    await ss(pageA, 'waku-03-A-added-contact');

    const aText = (await pageA.locator('#root').textContent())?.toLowerCase() ?? '';
    const aHasContact = aText.includes('bbbb') || aText.includes('contacts [1]');
    console.log(`  A sees B as contact: ${aHasContact}`);
  } else {
    console.log('  Add contact input not found');
  }
  console.log('');

  // ===== STEP 4: B checks if got the contact from X3DH init =====
  console.log('STEP 4: B checks for incoming X3DH (polling up to 90s)');
  let bHasContact = false;
  for (let i = 0; i < 45; i++) {
    await pageB.waitForTimeout(2000);
    const t = (await pageB.locator('#root').textContent())?.toLowerCase() ?? '';
    if (t.includes('aaaa') || t.includes('contacts [1]')) {
      bHasContact = true;
      break;
    }
  }
  await ss(pageB, 'waku-04-B-contacts');
  console.log(`  B sees A as contact: ${bHasContact}`);
  console.log('');

  // ===== STEP 5: A selects B and sends message =====
  console.log('STEP 5: A sends message to B');
  // Click on B's contact entry
  const contactBtnA = pageA.locator('button').filter({ hasText: /bbbb/i }).first();
  if (await contactBtnA.isVisible().catch(() => false)) {
    await contactBtnA.click();
    await pageA.waitForTimeout(1000);

    const msgInput = pageA.locator('input[placeholder*="message" i], input[placeholder*="type" i]').first();
    if (await msgInput.isVisible().catch(() => false)) {
      await msgInput.fill('Hello via Waku!');
      const sendBtn = pageA.locator('button').filter({ hasText: /\[send\]/i }).first();
      if (await sendBtn.isVisible()) {
        await sendBtn.click();
      } else {
        await msgInput.press('Enter');
      }
      // Wait for message to appear in UI
      for (let i = 0; i < 15; i++) {
        await pageA.waitForTimeout(1000);
        const t = (await pageA.locator('#root').textContent()) ?? '';
        if (t.includes('Hello via Waku!')) break;
      }
    }
    await ss(pageA, 'waku-05-A-sent');
    const aContent = (await pageA.locator('#root').textContent()) ?? '';
    console.log(`  A sees own message: ${aContent.includes('Hello via Waku!')}`);
  } else {
    console.log('  B contact button not found on A');
  }
  console.log('');

  // ===== STEP 6: B selects A and checks for message =====
  console.log('STEP 6: B receives message from A');
  const contactBtnB = pageB.locator('button').filter({ hasText: /aaaa/i }).first();
  if (await contactBtnB.isVisible().catch(() => false)) {
    await contactBtnB.click();
    await pageB.waitForTimeout(2000);
  }
  // Poll for message arrival
  let bReceivedA = false;
  for (let i = 0; i < 30; i++) {
    await pageB.waitForTimeout(2000);
    const t = (await pageB.locator('#root').textContent()) ?? '';
    if (t.includes('Hello via Waku!')) {
      bReceivedA = true;
      break;
    }
  }
  await ss(pageB, 'waku-06-B-received');
  console.log(`  B received A's message: ${bReceivedA}`);
  console.log('');

  // ===== STEP 7: B replies =====
  console.log('STEP 7: B replies to A');
  const msgInputB = pageB.locator('input[placeholder*="message" i], input[placeholder*="type" i]').first();
  if (await msgInputB.isVisible().catch(() => false)) {
    await msgInputB.fill('Reply via Waku!');
    const sendBtnB = pageB.locator('button').filter({ hasText: /\[send\]/i }).first();
    if (await sendBtnB.isVisible()) {
      await sendBtnB.click();
    } else {
      await msgInputB.press('Enter');
    }
    await pageB.waitForTimeout(3000);
    await ss(pageB, 'waku-07-B-replied');
    const bContent2 = (await pageB.locator('#root').textContent()) ?? '';
    console.log(`  B sees own reply: ${bContent2.includes('Reply via Waku!')}`);
  }
  console.log('');

  // ===== STEP 8: A checks for B's reply =====
  console.log('STEP 8: A receives B reply');
  let aReceivedB = false;
  for (let i = 0; i < 30; i++) {
    await pageA.waitForTimeout(2000);
    const t = (await pageA.locator('#root').textContent()) ?? '';
    if (t.includes('Reply via Waku!')) {
      aReceivedB = true;
      break;
    }
  }
  await ss(pageA, 'waku-08-A-received-reply');
  console.log(`  A received B's reply: ${aReceivedB}`);
  console.log('');

  // ===== Debug Logs =====
  console.log('=== Waku Logs (A) ===');
  logsA.filter(l => l.includes('[waku]') || l.includes('[wire]') || l.includes('[x3dh]') || l.includes('[handleMessage]') || l.includes('[chat]') || l.includes('pageerror') || l.includes('rror')).forEach(l => console.log(`  ${l}`));
  console.log('\n=== Waku Logs (B) ===');
  logsB.filter(l => l.includes('[waku]') || l.includes('[wire]') || l.includes('[x3dh]') || l.includes('[handleMessage]') || l.includes('[chat]') || l.includes('pageerror') || l.includes('rror')).forEach(l => console.log(`  ${l}`));

  // ===== Results =====
  console.log('\n=== RESULTS ===');
  const results = [
    ['Wallet A connected', true],
    ['Wallet B connected', true],
    ['Waku A connected', wakuA],
    ['Waku B connected', wakuB],
    ['A added B as contact', (await pageA.locator('#root').textContent() ?? '').toLowerCase().includes('bbbb')],
    ['B received X3DH from A', bHasContact],
    ['A sent message', (await pageA.locator('#root').textContent() ?? '').includes('Hello via Waku!')],
    ['B received message', bReceivedA],
    ['B sent reply', (await pageB.locator('#root').textContent() ?? '').includes('Reply via Waku!')],
    ['A received reply', aReceivedB],
  ] as const;

  let allPass = true;
  for (const [name, pass] of results) {
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`);
    if (!pass) allPass = false;
  }
  console.log(`\n  ${allPass ? 'ALL PASSED' : 'SOME FAILED'}`);

  await browser.close();
  console.log('\n=== Done ===');
  if (!allPass) process.exit(1);
}

test().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
