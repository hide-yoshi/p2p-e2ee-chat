import { createLightNode, type LightNode } from '@waku/sdk';
import { Protocols } from '@waku/interfaces';
import type { IEncoder, IDecoder, IDecodedMessage } from '@waku/interfaces';
import type { WireMessage, PreKeyBundle } from '../types';

const APP_NAME = 'p2p-e2ee-chat';
const APP_VERSION = '1';

// Single content topic for all messages to ensure reliable Filter delivery.
// Multiple content topics can land on different shards/relay nodes, causing
// messages to silently disappear. A single topic guarantees that if Filter
// works at all, ALL message types are delivered.
const GLOBAL_TOPIC = `/${APP_NAME}/${APP_VERSION}/global/proto`;

// Envelope wrapping all messages on the global topic
interface Envelope {
  type: 'prekey' | 'inbox' | 'chat';
  to: string; // recipient address (lowercased) or conversation id
  payload: unknown;
}

export type MessageHandler = (msg: WireMessage) => void;

export class WakuTransport {
  private node: LightNode | null = null;
  private encoder: IEncoder | null = null;
  private decoder: IDecoder<IDecodedMessage> | null = null;
  private readyPromise: Promise<void>;
  private _ready = false;

  // Handlers keyed by "type:target"
  private handlers = new Map<string, Set<(data: unknown) => void>>();

  constructor() {
    this.readyPromise = this.init();
  }

  private async init() {
    try {
      console.log('[waku] creating light node...');
      this.node = await createLightNode({ defaultBootstrap: true });
      await this.node.start();
      console.log('[waku] node started, waiting for remote peers...');
      await this.node.waitForPeers(
        [Protocols.Filter, Protocols.LightPush],
        60_000
      );
      try {
        await this.node.waitForPeers([Protocols.Store], 10_000);
        console.log('[waku] store peer available');
      } catch {
        console.log('[waku] no store peer available (store queries will be skipped)');
      }

      this.encoder = this.node.createEncoder({ contentTopic: GLOBAL_TOPIC });
      this.decoder = this.node.createDecoder({ contentTopic: GLOBAL_TOPIC });

      // Single global filter subscription
      await this.node.filter.subscribe([this.decoder], (wakuMsg) => {
        if (!wakuMsg.payload) return;
        try {
          const envelope: Envelope = JSON.parse(new TextDecoder().decode(wakuMsg.payload));
          const key = `${envelope.type}:${envelope.to.toLowerCase()}`;
          console.log('[waku] filter received envelope', envelope.type, 'to', envelope.to);
          const set = this.handlers.get(key);
          if (set) {
            for (const h of set) h(envelope.payload);
          }
        } catch {}
      });
      console.log('[waku] subscribed to global topic');

      this._ready = true;
      console.log('[waku] connected to remote peers');
    } catch (err) {
      console.error('[waku] init failed:', err);
    }
  }

  get ready(): Promise<void> {
    return this.readyPromise;
  }

  get isReady(): boolean {
    return this._ready;
  }

  private addHandler(type: string, target: string, handler: (data: unknown) => void): void {
    const key = `${type}:${target.toLowerCase()}`;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
  }

  private async publish(envelope: Envelope): Promise<void> {
    if (!this.node?.lightPush || !this.encoder) return;
    await this.readyPromise;
    const payload = new TextEncoder().encode(JSON.stringify(envelope));
    try {
      await this.node.lightPush.send(this.encoder, { payload });
    } catch (err) {
      console.error('[waku] publish failed:', err);
    }
  }

  private async queryHistory<T = unknown>(type: string, target: string): Promise<T[]> {
    if (!this.node?.store || !this.decoder) return [];
    await this.readyPromise;
    const results: T[] = [];
    const targetLower = target.toLowerCase();
    try {
      for await (const page of this.node.store.queryGenerator([this.decoder])) {
        for (const promiseOrMsg of page) {
          const wakuMsg = await promiseOrMsg;
          if (!wakuMsg?.payload) continue;
          try {
            const envelope: Envelope = JSON.parse(new TextDecoder().decode(wakuMsg.payload));
            if (envelope.type === type && envelope.to.toLowerCase() === targetLower) {
              results.push(envelope.payload as T);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error('[waku] store query failed:', err);
    }
    return results;
  }

  // --- High-level API ---

  async publishPreKeyBundle(bundle: PreKeyBundle): Promise<void> {
    await this.publish({ type: 'prekey', to: bundle.address, payload: bundle });
    console.log('[waku] published pre-key bundle for', bundle.address);
  }

  async fetchPreKeyBundle(address: string, timeoutMs = 90000): Promise<PreKeyBundle | null> {
    // Try store first
    const bundles = await this.queryHistory<PreKeyBundle>('prekey', address);
    if (bundles.length > 0) {
      return bundles.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    // Wait for bundle via Filter
    console.log('[waku] pre-key bundle not in store, subscribing and waiting...');
    return new Promise<PreKeyBundle | null>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[waku] fetchPreKeyBundle timed out after', timeoutMs, 'ms');
          resolve(null);
        }
      }, timeoutMs);

      this.addHandler('prekey', address, (data) => {
        console.log('[waku] fetchPreKeyBundle received data via filter:', !!data);
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(data as PreKeyBundle);
        }
      });
    });
  }

  async sendMessage(conversationId: string, msg: WireMessage): Promise<void> {
    console.log('[waku] sendMessage to conv', conversationId, 'kind:', msg.kind);
    await this.publish({ type: 'chat', to: conversationId, payload: msg });
  }

  async sendToInbox(address: string, msg: WireMessage): Promise<void> {
    console.log('[waku] sendToInbox', address, 'kind:', msg.kind);
    await this.publish({ type: 'inbox', to: address, payload: msg });
  }

  async subscribeToChat(conversationId: string, handler: MessageHandler): Promise<void> {
    this.addHandler('chat', conversationId, (data) => handler(data as WireMessage));
    console.log('[waku] registered chat handler for', conversationId);
  }

  async subscribeToInbox(address: string, handler: MessageHandler): Promise<void> {
    this.addHandler('inbox', address, (data) => handler(data as WireMessage));
    console.log('[waku] registered inbox handler for', address);
  }

  async fetchChatHistory(conversationId: string): Promise<WireMessage[]> {
    return this.queryHistory<WireMessage>('chat', conversationId);
  }

  async fetchInbox(address: string): Promise<WireMessage[]> {
    return this.queryHistory<WireMessage>('inbox', address);
  }

  async resubscribe(): Promise<void> {
    if (!this.node?.filter || !this.decoder) return;
    try {
      await this.node.filter.subscribe([this.decoder], (wakuMsg) => {
        if (!wakuMsg.payload) return;
        try {
          const envelope: Envelope = JSON.parse(new TextDecoder().decode(wakuMsg.payload));
          const key = `${envelope.type}:${envelope.to.toLowerCase()}`;
          console.log('[waku] filter received envelope', envelope.type, 'to', envelope.to);
          const set = this.handlers.get(key);
          if (set) {
            for (const h of set) h(envelope.payload);
          }
        } catch {}
      });
      console.log('[waku] re-subscribed to global topic');
    } catch (err) {
      console.error('[waku] re-subscribe failed:', err);
    }
  }

  async destroy(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
      this._ready = false;
    }
  }
}
