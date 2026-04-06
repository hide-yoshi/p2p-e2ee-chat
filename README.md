# P2P E2EE Chat

Serverless, end-to-end encrypted peer-to-peer group chat application. No central server required.

## Features

- **E2EE** - ECDH (P-256) key exchange + AES-256-GCM message encryption
- **P2P** - WebRTC DataChannel mesh network via simple-peer
- **Wallet Auth** - EIP-1193 wallet (MetaMask, Brave, etc.) for identity
- **Group Chat** - Invite-only rooms with encrypted group key distribution
- **File Sharing** - Encrypted file transfer via IPFS (Helia)
- **Local History** - IndexedDB (Dexie.js) for message persistence
- **IPFS Backup** - Encrypted chat history backup/restore via Helia
- **QR Signaling** - QR code or copy-paste SDP exchange (no signaling server)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Vite + React + TypeScript |
| UI | Tailwind CSS |
| P2P | simple-peer (WebRTC) |
| Wallet | wagmi + viem |
| Encryption | Web Crypto API |
| Local DB | Dexie.js (IndexedDB) |
| IPFS | Helia |
| QR Code | qrcode.react + html5-qrcode |

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and connect your wallet.

### Connecting Peers

1. Click **+ Connect** in the sidebar
2. One peer selects **Create Invite**, the other selects **Join**
3. Exchange QR codes or copy-paste the signal data
4. Once connected, create a room and invite the peer

### Backup / Restore

1. Click **Backup / Restore** in the sidebar
2. Select a room and click **Backup to IPFS**
3. Save the CID
4. On another device, enter the CID to restore

## Architecture

```
Browser A  <--WebRTC DataChannel (E2EE)--->  Browser B
    |                                            |
    |--- IndexedDB (local history)               |--- IndexedDB (local history)
    |--- Helia IPFS (encrypted backup)           |--- Helia IPFS (encrypted backup)
    |--- MetaMask (identity/auth)                |--- MetaMask (identity/auth)
```

### Encryption Flow

1. Each device generates an ECDH key pair (P-256)
2. The ECDH public key is signed by the wallet (`personal_sign`)
3. Peers exchange signed public keys during WebRTC signaling
4. Pairwise shared secrets are derived via ECDH
5. Room creator generates an AES-256-GCM group key
6. Group key is wrapped with each pairwise key and distributed
7. All messages are encrypted with the group key

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Type check + production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

## License

MIT
