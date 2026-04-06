# CLAUDE.md

## Project Overview

P2P E2EE group chat app. Fully serverless - no backend, no signaling server. Uses WebRTC for communication, MetaMask for identity, and IPFS for backup.

## Commands

- `npm run dev` - Start dev server (port 5173)
- `npm run build` - Type check (`tsc -b`) + Vite production build
- `npm run lint` - ESLint

## Project Structure

```
src/
├── types/index.ts         # Shared type definitions
├── lib/
│   ├── crypto.ts          # ECDH + AES-256-GCM (Web Crypto API)
│   ├── wallet.ts          # wagmi wallet connection + ECDH key signing
│   ├── peer.ts            # PeerManager - WebRTC mesh via simple-peer
│   ├── db.ts              # Dexie.js schema (IndexedDB)
│   └── ipfs.ts            # Helia IPFS upload/download with encryption
├── hooks/
│   └── useChat.ts         # Core chat logic (rooms, messages, peer management)
├── components/
│   ├── WalletConnect.tsx   # Wallet connection screen
│   ├── QRSignaling.tsx     # QR code + copy-paste SDP exchange
│   ├── ConnectPeerModal.tsx # Peer connection flow (offer/answer)
│   ├── InviteModal.tsx     # Room invitation modal
│   ├── BackupRestore.tsx   # IPFS backup/restore modal
│   ├── Sidebar.tsx         # Room list, peer list, actions
│   └── ChatView.tsx        # Message display + input
├── App.tsx                 # Main app (auth gate + chat layout)
├── main.tsx                # Entry point (no StrictMode - WebRTC compat)
└── index.css               # Tailwind import
```

## Key Design Decisions

- **No StrictMode** in main.tsx - WebRTC connections break with double-render
- **Mesh topology** for group chat - every peer connects to every other peer. Practical limit ~10 peers
- **Group key distribution** - room creator generates AES key, wraps it with each pairwise ECDH shared secret
- **QR + copy-paste signaling** - SDP data can exceed QR capacity, so both methods are available
- **Wallet = identity** - no separate auth system. ECDH public key is signed by wallet to prove ownership

## Crypto

- Key exchange: ECDH P-256
- Message encryption: AES-256-GCM
- Key derivation: Web Crypto `deriveKey`
- All via native Web Crypto API (no external crypto libs)
