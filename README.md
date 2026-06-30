<div align="center">

# 🔐 LockPin

**Local-first, zero-knowledge password manager built with Tauri v2, Rust and React.**

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.80+-CE422B?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)](https://github.com/microsoft/windows)

Your passwords never leave your machine. No accounts. No cloud sync. No telemetry.

</div>

---

## Why LockPin?

Most password managers store your data in their cloud and charge a monthly fee for the privilege. LockPin takes the opposite approach: **your vault lives on your disk, encrypted, and only you hold the key.**

- **Air-gap friendly** — works fully offline, always
- **No vendor lock-in** — open source, your data stays yours
- **Zero-knowledge** — the app never sees your plaintext passwords
- **Native performance** — Rust backend, sub-100ms unlock

---

## Features

### Security
| Feature | Details |
|---|---|
| **Encryption** | AES-256-GCM with per-vault keys |
| **Key derivation** | Argon2id (64 MB, 3 iterations) + PBKDF2-SHA-256 (600k iterations) |
| **Windows Hello** | Biometric/PIN unlock via DPAPI-protected master key |
| **Duress password** | Opens a decoy empty vault without revealing the real one |
| **Kill switch** | Destroys vault data on specific password entry |
| **Recovery** | 12-word BIP39-style phrase encrypted separately from the vault |
| **Auto-lock** | Configurable timeout with 30-second warning |
| **Anti-debug** | Detects debugger presence on Windows, exits immediately |
| **Secure delete** | Overwrites vault files with random bytes before removal |
| **Rate limiting** | Rust-side brute-force protection on all vault operations |
| **CSP** | Strict Content Security Policy via Tauri's security layer |

### Vault
| Feature | Details |
|---|---|
| **Multi-vault** | One independent vault per master password, coexisting on the same machine |
| **Item types** | Passwords, TOTP seeds, passkeys, credit cards, secure notes, identities |
| **TOTP** | Built-in authenticator — generates codes in-app, no external app needed |
| **Secure files** | Attach files up to 50 MB per item, stored as encrypted blobs |
| **Folders** | Organize items with color-coded folders; files stored per folder |
| **Trash** | Soft-delete with restore and empty-trash support |
| **Audit log** | Immutable action log per organization |
| **Password generator** | Configurable length, charset, strength meter |
| **Clipboard** | Auto-clears clipboard 10 seconds after copy |
| **Search** | Instant full-text filter across title, username, URL and tags |
| **Backups** | Auto-backup on every save to `backups/vault-{id}-{timestamp}.enc` |

### UX
- Dark and light theme with live switching
- Keyboard shortcut navigation
- Password strength indicator
- Collapsible sidebar with collection and folder views

---

## Architecture

```
lockpin-v3/
├── src-tauri/          # Rust backend (Tauri v2)
│   └── src/lib.rs      # Argon2, AES, DPAPI, rate limiter, file I/O
├── core/
│   ├── crypto/         # AES-256-GCM, PBKDF2, HMAC
│   └── vault/          # Storage, types, TOTP, import/export, health
├── apps/desktop/       # Main UI screens (Login, Vault, FolderPane)
├── ui/
│   ├── components/     # Atoms, molecules, organisms (Modal, Toast, etc.)
│   ├── contexts/       # ThemeContext, useDebounce, useKeyboard
│   └── design-system/  # Token system (colors, spacing, typography)
├── shared/             # Constants, types, utils
└── src/main.tsx        # React root, auth state, vault lifecycle
```

### Data flow

```
User input
    │
    ▼
React UI (TypeScript)
    │  invoke()
    ▼
Tauri IPC bridge
    │
    ▼
Rust commands (lib.rs)
    │  rate limit → file I/O
    ▼
vault-{uuid}.enc  ←→  vaults.auth (multi-line auth registry)
```

### Vault file format

Each vault is stored as `vault-{uuid}.enc` — a JSON blob encrypted with AES-256-GCM:

```
[4 bytes: salt length] [salt] [12 bytes: IV] [ciphertext] [16 bytes: GCM auth tag] [32 bytes: HMAC-SHA256]
```

Authentication is stored separately in `vaults.auth`:

```
{vault_id}|{master_salt}|{master_hash}|{duress_salt}|{duress_hash}|{kill_salt}|{kill_hash}|{dpapi_blob}|{recovery_blob}
```

This separation means the vault file itself contains no credentials — an attacker who obtains only `vault-*.enc` cannot attempt offline dictionary attacks without the corresponding auth entry.

---

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Rust 1.80+](https://rustup.rs)
- [Tauri CLI prerequisites for Windows](https://tauri.app/start/prerequisites/)

### Development

```bash
git clone https://github.com/YOUR_USERNAME/lockpin.git
cd lockpin

npm install
npm run tauri:dev
```

### Production build

```bash
npm run tauri:build
```

The installer is output to `src-tauri/target/release/bundle/`.

### Useful scripts

```bash
npm run typecheck     # TypeScript check (no emit)
npm run lint          # ESLint
npm run test          # Vitest unit tests
cargo check           # Rust type check (run inside src-tauri/)
```

---

## Security Model

LockPin's security rests on three pillars:

**1. Zero server surface** — there is no backend server, no API, no account system. The attack surface is limited to the local filesystem and the Tauri IPC bridge.

**2. Layered key derivation** — unlocking requires both knowing the master password and having access to the local `vaults.auth` file. Neither alone is sufficient.

**3. Defense in depth** — even if an attacker bypasses the UI, the Rust layer enforces rate limits, wipes vault files before deletion, detects debugger attachment, and disables crash dumps to prevent memory forensics.

### What LockPin does NOT protect against

- A fully compromised OS (keyloggers, root access)
- Physical access to an unlocked machine
- Screen recording attacks

---

## Roadmap

- [ ] macOS / Linux support
- [ ] Browser extension (autofill)
- [ ] Encrypted export / import (Bitwarden-compatible format)
- [ ] Password sharing via encrypted QR code
- [ ] YubiKey as second factor

---

## License

MIT © 2025 — see [LICENSE](LICENSE) for details.
