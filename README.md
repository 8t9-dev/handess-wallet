# Handess Wallet

A self-custody desktop wallet for **Handshake (HNS)**, with a domain CRM, a peer-to-peer name marketplace, optional 2-of-3 escrow, and atomic swaps between **HNS and DigiByte (DGB)**.

Created by **8t9.dev**.

> **Beta software. Unsigned builds. Not independently audited.**
> Use small amounts, keep backups, and never share your seed phrase, passphrase, WIF, or API keys.

## Features

- Handshake wallet and domain management
- Domain CRM: tags, watchlist, history, bulk search
- Peer-to-peer name marketplace with optional 2-of-3 escrow
- HNS ↔ DGB atomic swaps via hash time-lock contracts
- Optional auto-complete for accepted swaps
- Local HSD node management or connection to an existing node

## Downloads

Prebuilt Windows and Linux packages are published in the release repository:

<https://github.com/8t9-dev/handess-wallet-releases/releases>

The optional Node.js + HSD runtime is downloaded separately by the setup wizard. Existing Node.js or HSD installations can be reused.

## Requirements

- Windows 10/11 x64, or Linux x64
- For development: Node.js 24 and npm
- A Handshake node (`hsd`) is required at runtime. The setup wizard can install a private runtime, or you can point the app at an existing HSD data directory.

## Build from source

```bash
npm ci
npm run dev          # development
npm test             # unit tests
npm run typecheck
npm run lint
npm run package-win  # Windows MSI
npm run package-linux
```

Useful scripts:

- `npm run notices` — regenerate `THIRD_PARTY_NOTICES.md`
- `npm run index:build` — rebuild the bundled HNS search index from a local HSD chain database
- `npm run arbiter:sign` — offline signer for marketplace escrow spends

## Project layout

- `electron/` — main process, services, IPC
- `src/` — React renderer, stores, components, shared types
- `scripts/` — build and maintenance tools
- `resources/` — icon and bundled HNS search index seed

## License

Handess Wallet is free software licensed under the **GNU General Public License, version 3 or (at your option) any later version** (`GPL-3.0-or-later`).

Copyright (C) 2026 **8t9.dev**.

See [LICENSE](LICENSE) for the full license text and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party attributions. Third-party components remain under their own licenses.

The **Handess** name and logo are branding of 8t9.dev and are not licensed under the GPL. Modified versions should use different branding.

## Security

This is beta wallet software. Keep your seed phrase and passphrases offline and private. Report bugs and security issues through the repository issue tracker:

<https://github.com/8t9-dev/handess-wallet/issues>

Never post seed phrases, private keys, WIFs, passphrases, API keys, or signed PSBTs in public issues.
