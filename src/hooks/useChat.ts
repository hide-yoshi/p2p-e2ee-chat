import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, Contact, WireMessage, PreKeyBundle } from '../types';
import { WakuTransport } from '../lib/waku';
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  exportKey,
  importAESKey,
  encrypt,
  decrypt,
  x3dhInitiate,
  x3dhRespond,
  getConversationId,
} from '../lib/crypto';
import { signECDHKey } from '../lib/wallet';
import { db } from '../lib/db';

interface Identity {
  address: string;
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  signature: string;
}

interface KeyBundle {
  identityKeyPair: CryptoKeyPair;
  signedPreKeyPair: CryptoKeyPair;
  oneTimePreKeyPairs: CryptoKeyPair[];
}

export function useChat(identity: Identity) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentContact, setCurrentContact] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [wakuReady, setWakuReady] = useState(false);

  const wakuRef = useRef<WakuTransport | null>(null);
  const keyBundleRef = useRef<KeyBundle | null>(null);
  const currentContactRef = useRef<string | null>(null);
  const seenMessages = useRef(new Set<string>());
  // Pending x3dh-init messages to re-send until the peer acknowledges
  const pendingX3dhInits = useRef<Map<string, WireMessage>>(new Map());
  // Pending outgoing messages to re-send (keyed by messageId → {to, msg})
  const pendingOutgoing = useRef<Map<string, { to: string; msg: WireMessage }>>(new Map());

  useEffect(() => {
    currentContactRef.current = currentContact;
  }, [currentContact]);

  // Load contacts from DB
  useEffect(() => {
    db.contacts.toArray().then(setContacts);
  }, []);

  // Load messages when switching conversation
  useEffect(() => {
    if (!currentContact) {
      setMessages([]);
      return;
    }
    const convId = getConversationId(identity.address, currentContact);
    db.messages
      .where('conversationId')
      .equals(convId)
      .sortBy('timestamp')
      .then(setMessages);
  }, [currentContact, identity.address]);

  const isNewMessage = useCallback((messageId: string): boolean => {
    if (seenMessages.current.has(messageId)) return false;
    seenMessages.current.add(messageId);
    if (seenMessages.current.size > 1000) {
      const arr = Array.from(seenMessages.current);
      seenMessages.current = new Set(arr.slice(arr.length - 500));
    }
    return true;
  }, []);

  // Handle incoming wire messages
  const handleMessage = useCallback(
    async (msg: WireMessage) => {
      console.log('[handleMessage] kind:', msg.kind, 'from:', msg.senderAddress, 'myAddr:', identity.address);
      if (msg.senderAddress === identity.address) {
        console.log('[handleMessage] skipping own message');
        return;
      }
      if (msg.messageId && !isNewMessage(msg.messageId)) {
        console.log('[handleMessage] skipping duplicate:', msg.messageId);
        return;
      }

      if (msg.kind === 'x3dh-init') {
        // X3DH initial message: derive shared key and save contact
        await handleX3DHInit(msg);
      } else if (msg.kind === 'chat') {
        await handleChatMessage(msg);
      }
    },
    [identity.address, isNewMessage]
  );

  async function handleX3DHInit(msg: WireMessage) {
    console.log('[x3dh] handleX3DHInit called, hasKeyBundle:', !!keyBundleRef.current, 'hasEphemeralKey:', !!msg.ephemeralKey);
    if (!keyBundleRef.current || !msg.ephemeralKey) return;

    try {
      const kb = keyBundleRef.current;
      const aliceEphemeralPublic = await importPublicKey(msg.ephemeralKey);
      const aliceIdentityPublic = await importPublicKey(
        JSON.parse(msg.payload) // payload contains alice's identity public key for x3dh-init
      );

      let opkPrivate: CryptoKey | undefined;
      if (msg.usedOneTimeKeyIndex !== undefined && kb.oneTimePreKeyPairs[msg.usedOneTimeKeyIndex]) {
        opkPrivate = kb.oneTimePreKeyPairs[msg.usedOneTimeKeyIndex].privateKey;
      }

      const sharedKey = await x3dhRespond(
        kb.identityKeyPair.privateKey,
        kb.signedPreKeyPair.privateKey,
        aliceIdentityPublic,
        aliceEphemeralPublic,
        opkPrivate
      );

      const sharedKeyStr = await exportKey(sharedKey);
      const identityKeyJwk = await exportPublicKey(aliceIdentityPublic);

      const contact: Contact = {
        address: msg.senderAddress,
        identityKey: identityKeyJwk,
        sharedKey: sharedKeyStr,
        addedAt: Date.now(),
      };

      await db.contacts.put(contact);
      setContacts((prev) => {
        const exists = prev.findIndex((c) => c.address === msg.senderAddress);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = contact;
          return updated;
        }
        return [...prev, contact];
      });
      console.log('[x3dh] contact saved:', msg.senderAddress);
    } catch (err) {
      console.error('[x3dh] handleX3DHInit failed:', err);
    }
  }

  async function handleChatMessage(msg: WireMessage) {
    // Peer sent us a chat message, so they have our shared key - stop resending x3dh-init
    pendingX3dhInits.current.delete(msg.senderAddress.toLowerCase());
    // Clear pending outgoing messages to this peer (they're online and connected)
    for (const [id, entry] of pendingOutgoing.current) {
      if (entry.to.toLowerCase() === msg.senderAddress.toLowerCase()) {
        pendingOutgoing.current.delete(id);
      }
    }

    const contact = await db.contacts.get(msg.senderAddress);
    if (!contact) {
      console.log('[chat] no contact found for', msg.senderAddress);
      return;
    }

    let plaintext: string;
    try {
      const sharedKey = await importAESKey(contact.sharedKey);
      plaintext = await decrypt(sharedKey, msg.iv, msg.payload);
    } catch (err) {
      console.error('[chat] decrypt failed:', err);
      return;
    }
    const parsed = JSON.parse(plaintext);

    const chatMsg: ChatMessage = {
      id: msg.messageId,
      conversationId: msg.conversationId,
      senderAddress: msg.senderAddress,
      type: 'text',
      content: parsed.content,
      timestamp: msg.timestamp,
    };

    const existing = await db.messages.get(chatMsg.id);
    if (!existing) {
      await db.messages.add(chatMsg);
    }

    if (currentContactRef.current === msg.senderAddress) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === chatMsg.id)) return prev;
        return [...prev, chatMsg].sort((a, b) => a.timestamp - b.timestamp);
      });
    }
  }

  // Initialize Waku + generate X3DH key bundle
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      // Generate X3DH key bundle
      const identityKeyPair = { publicKey: identity.keyPair.publicKey, privateKey: identity.keyPair.privateKey };
      const signedPreKeyPair = await generateECDHKeyPair();
      const oneTimePreKeyPairs: CryptoKeyPair[] = [];
      for (let i = 0; i < 5; i++) {
        oneTimePreKeyPairs.push(await generateECDHKeyPair());
      }

      keyBundleRef.current = { identityKeyPair, signedPreKeyPair, oneTimePreKeyPairs };

      // Build pre-key bundle to publish
      const spkJwk = await exportPublicKey(signedPreKeyPair.publicKey);
      const spkSig = await signECDHKey(spkJwk);
      const opkJwks: JsonWebKey[] = [];
      for (const kp of oneTimePreKeyPairs) {
        opkJwks.push(await exportPublicKey(kp.publicKey));
      }

      const bundle: PreKeyBundle = {
        identityKey: identity.publicKeyJwk,
        signedPreKey: spkJwk,
        signedPreKeySig: spkSig,
        oneTimePreKeys: opkJwks,
        address: identity.address,
        timestamp: Date.now(),
      };

      // Init Waku
      const waku = new WakuTransport();
      wakuRef.current = waku;
      await waku.ready;

      if (cancelled) return;
      setWakuReady(true);

      // Publish pre-key bundle (and re-publish periodically for Filter-based discovery)
      await waku.publishPreKeyBundle(bundle);
      setInterval(() => {
        if (!cancelled) {
          waku.publishPreKeyBundle({ ...bundle, timestamp: Date.now() });
        }
      }, 10_000);

      // Subscribe to inbox for incoming X3DH init messages
      await waku.subscribeToInbox(identity.address, handleMessage);

      // Check inbox for missed messages
      const inboxMsgs = await waku.fetchInbox(identity.address);
      for (const msg of inboxMsgs) {
        await handleMessage(msg);
      }

      // Periodically re-subscribe and re-send pending x3dh-init messages
      const resubInterval = setInterval(async () => {
        if (cancelled) return;
        try {
          await waku.resubscribe();
        } catch (err) {
          console.error('[waku] re-subscribe error:', err);
        }
      }, 30_000);

      // Re-send pending messages every 5 seconds until delivered
      const resendInterval = setInterval(async () => {
        if (cancelled) return;
        for (const [addr, msg] of pendingX3dhInits.current) {
          console.log('[waku] re-sending x3dh-init to', addr);
          await waku.sendToInbox(addr, msg);
        }
        for (const [id, { to, msg }] of pendingOutgoing.current) {
          console.log('[waku] re-sending chat msg', id.slice(0, 8), 'to', to.slice(0, 10));
          await waku.sendToInbox(to, msg);
        }
      }, 5_000);

      cleanupTimers = () => {
        clearInterval(resubInterval);
        clearInterval(resendInterval);
      };
    }

    let cleanupTimers: (() => void) | undefined;
    setup();
    return () => {
      cancelled = true;
      cleanupTimers?.();
      wakuRef.current?.destroy();
    };
  }, [identity, handleMessage]);

  // Add contact by address: fetch their pre-key bundle, perform X3DH
  const addContact = useCallback(
    async (peerAddress: string): Promise<boolean> => {
      const waku = wakuRef.current;
      if (!waku || !keyBundleRef.current) return false;

      // Check if already a contact
      const existing = await db.contacts.get(peerAddress);
      if (existing) return true;

      // Fetch their pre-key bundle from Waku Store
      const bundle = await waku.fetchPreKeyBundle(peerAddress);
      if (!bundle) return false;

      // Perform X3DH as initiator
      const ephemeralKeyPair = await generateECDHKeyPair();
      const bobIK = await importPublicKey(bundle.identityKey);
      const bobSPK = await importPublicKey(bundle.signedPreKey);

      let bobOPK: CryptoKey | undefined;
      let opkIndex: number | undefined;
      if (bundle.oneTimePreKeys.length > 0) {
        opkIndex = 0;
        bobOPK = await importPublicKey(bundle.oneTimePreKeys[0]);
      }

      const sharedKey = await x3dhInitiate(
        keyBundleRef.current.identityKeyPair.privateKey,
        ephemeralKeyPair.privateKey,
        bobIK,
        bobSPK,
        bobOPK
      );

      const sharedKeyStr = await exportKey(sharedKey);
      const ephemeralKeyJwk = await exportPublicKey(ephemeralKeyPair.publicKey);

      // Save contact
      const contact: Contact = {
        address: peerAddress,
        identityKey: bundle.identityKey,
        sharedKey: sharedKeyStr,
        addedAt: Date.now(),
      };
      await db.contacts.put(contact);
      setContacts((prev) => [...prev, contact]);

      // Send X3DH init message to their inbox so they can derive the same shared key
      const convId = getConversationId(identity.address, peerAddress);
      const initMsg: WireMessage = {
        kind: 'x3dh-init',
        messageId: crypto.randomUUID(),
        conversationId: convId,
        payload: JSON.stringify(identity.publicKeyJwk), // our identity public key
        iv: '',
        senderAddress: identity.address,
        ephemeralKey: ephemeralKeyJwk,
        usedOneTimeKeyIndex: opkIndex,
        timestamp: Date.now(),
      };
      await waku.sendToInbox(peerAddress, initMsg);

      // Store for periodic re-sending until peer processes it
      pendingX3dhInits.current.set(peerAddress.toLowerCase(), initMsg);

      return true;
    },
    [identity, handleMessage]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentContact) return;
      const waku = wakuRef.current;
      if (!waku) return;

      const contact = await db.contacts.get(currentContact);
      if (!contact) return;

      const sharedKey = await importAESKey(contact.sharedKey);
      const plaintext = JSON.stringify({ content });
      const { iv, ciphertext } = await encrypt(sharedKey, plaintext);

      const convId = getConversationId(identity.address, currentContact);
      const messageId = crypto.randomUUID();

      const wireMsg: WireMessage = {
        kind: 'chat',
        messageId,
        conversationId: convId,
        payload: ciphertext,
        iv,
        senderAddress: identity.address,
        timestamp: Date.now(),
      };

      seenMessages.current.add(messageId);
      // Send to recipient's inbox and queue for re-sending
      await waku.sendToInbox(currentContact, wireMsg);
      pendingOutgoing.current.set(messageId, { to: currentContact, msg: wireMsg });

      const chatMsg: ChatMessage = {
        id: messageId,
        conversationId: convId,
        senderAddress: identity.address,
        type: 'text',
        content,
        timestamp: wireMsg.timestamp,
      };
      await db.messages.add(chatMsg);
      setMessages((prev) => [...prev, chatMsg]);
    },
    [currentContact, identity.address]
  );

  return {
    contacts,
    currentContact,
    setCurrentContact,
    messages,
    wakuReady,
    addContact,
    sendMessage,
  };
}
