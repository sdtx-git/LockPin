<div align="center">

<img src="src-tauri/icons/app-icon.svg" width="96" alt="LockPin logo: five brass pins split at the shear line" />

# LockPin

**Local-first, zero-knowledge password manager built with Tauri v2, Rust and React.**

*Like the pins of a lock, only the right key lines everything up.*

**English** · [Português](README.md)

[![Rust](https://img.shields.io/badge/Rust-1.80+-CE422B?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Portable-0078D4)](https://github.com/sdtx-git/LockPin/releases)

Your passwords never leave your device. No accounts. No cloud sync. No telemetry.

</div>

---

## Why LockPin?

Most password managers store your data in their cloud and charge a monthly fee for the privilege. LockPin takes the opposite approach: **your vault lives on your disk, encrypted, and only you hold the key.**

- **Air-gap friendly** — works fully offline, always
- **Portable** — one folder on a USB drive runs on Windows and Linux with the same vault
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
| **Windows Hello** | Biometric/PIN unlock via DPAPI-protected master key (Windows only) |
| **Duress password** | Opens a separate decoy vault (`vault-decoy-{id}.enc`) without revealing or touching the real one |
| **Kill switch** | Destroys the vault, its decoy and its backups on specific password entry; attachments are wiped when no other vault remains |
| **Recovery** | 12-word BIP39-style phrase encrypted separately from the vault |
| **Auto-lock** | Configurable timeout with 30-second warning |
| **Anti-debug** | Detects debugger presence (Windows API / Linux `TracerPid`), exits immediately |
| **Secure delete** | Overwrites vault files with random bytes before removal |
| **Rate limiting** | Rust-side brute-force protection on all vault operations |
| **CSP** | Strict Content Security Policy via Tauri's security layer |

### Vault
| Feature | Details |
|---|---|
| **Multi-vault** | One independent vault per master password, coexisting on the same machine |
| **Item types** | Passwords, TOTP seeds, passkeys, credit cards, secure notes, identities |
| **TOTP** | Built-in authenticator — generates codes in-app (SHA-1/256/512, 6–8 digits, any period); accepts `otpauth://` links and QR code images |
| **Import** | Bitwarden, Chrome and generic CSV; authenticators from Google Authenticator (transfer QR), Aegis (plain JSON), 2FAS (no password) and `otpauth://` lists |
| **Secure files** | Attach files up to 50 MB per item, stored as encrypted blobs |
| **Folders** | Organize items with color-coded folders; files stored per folder |
| **Trash** | Soft-delete with restore and empty-trash support |
| **Audit log** | Immutable action log per organization |
| **Password generator** | Configurable length, charset, strength meter |
| **Clipboard** | Auto-clears clipboard 10 seconds after copy |
| **Search** | Instant full-text filter across title, username, URL and tags |
| **Backups** | Auto-backup at most every 10 minutes to `backups/vault-{id}-{timestamp}.enc`, keeping the 20 most recent per vault |

### UX
- Brand identity built on the pin tumbler: brass pins split at a blue shear line; on the login screen the pins shift as you type and align on unlock
- Dark and light theme with live switching
- Twelve color palettes in Settings, each in light and dark: LockPin (default: deep petrol and brass), Petróleo, Cofre, Técnico, Monocromático, Alto contraste, AMOLED, Floresta, Oceano, Ametista, Vinho, Terracota
- Responsive layout: below 720px the sidebar becomes a drawer, list and detail become separate screens, dialogs become bottom sheets
- Keyboard shortcut navigation (`Ctrl N` new item, `Ctrl F` search, `Ctrl L` lock)
- Password strength indicator
- Collapsible sidebar with collection and folder views

---

## Architecture

```mermaid
flowchart LR
    subgraph Interface
        U[React UI<br/>login, vault, folders, item dialogs]
    end
    U --> K[core/crypto<br/>AES-256-GCM, PBKDF2, HMAC<br/>Web Crypto]
    U --> V[core/vault<br/>types, TOTP, import, health]
    K -->|argon2_derive_key| R
    U -->|invoke, ciphertext only| R[Rust commands lib.rs<br/>rate limit, atomic I/O, anti-debug]
    R --- F[("vault-{uuid}.enc<br/>encrypted vault")]
    R --- A[("vaults.auth<br/>salts, hashes,<br/>DPAPI and recovery blobs")]
    R --- T[(Attachments<br/>encrypted blobs)]
    R -.->|auto-backup, at most every 10 min| B[(backups/<br/>20 most recent per vault)]
    R -->|dpapi_protect, Windows Hello| W[Windows DPAPI<br/>biometric/PIN unlock]
```

- **Frontend:** encrypts and decrypts in the webview with Web Crypto; only the Argon2id derivation runs in Rust (`argon2_derive_key`).
- **Rust layer:** receives and stores ciphertext only, applying rate limits, atomic writes and secure delete.
- **Storage:** the vault and its credentials live in separate files, so `vault-*.enc` alone does not allow offline attacks.

### Repository layout

```
LockPin/
├── src-tauri/                  # Rust backend (Tauri v2)
│   ├── src/lib.rs              # Argon2, DPAPI, rate limiter, atomic file I/O, data location
│   ├── icons/app-icon.svg      # Source of every app icon (npx tauri icon)
│   └── gen/android/            # Android project (custom MainActivity and manifest)
├── core/
│   ├── crypto/                 # AES-256-GCM, PBKDF2, HMAC
│   └── vault/                  # Storage, types, TOTP, import/export, health
├── apps/desktop/               # Screens: Login, Vault, FolderPane, VaultItemDialog
├── ui/
│   ├── components/             # Atoms (Logo, TitleBar, Button), molecules, organisms (Modal, Toast)
│   ├── contexts/               # ThemeContext (theme + palette), useDebounce, useKeyboard
│   └── design-system/          # global.css (tokens and palettes), tokens.ts
├── shared/                     # Constants, types, utils
├── src/main.tsx                # React root, auth state, vault lifecycle
├── docker/                     # Dockerfile.dev, Dockerfile.portable, LockPin.sh launcher
├── code/docker-dev.ps1         # Build, test, run, APK and portable builds through Docker
└── .github/workflows/          # Release pipeline (installers + portable zip)
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

### Download (recommended)

Pre-built installers are available on the [Releases](https://github.com/sdtx-git/LockPin/releases) page.
No build tools required:

- **Linux** — `.deb`, `.rpm` or `.AppImage`
- **Windows** — `.msi` or `.exe` installer
- **Portable** — `LockPin-portable-<version>.zip` with `LockPin.exe`, `LockPin.AppImage` and `LockPin.sh`; unzip it on a USB drive (see [Portable](#portable-removable-drive-windows--linux))

The Windows binaries are not code-signed yet. On Windows 11 with **Smart App Control** turned on, they can be blocked; SmartScreen may also ask for confirmation on first run.

Android is in progress (debug APK builds through Docker); iOS is planned.

### Data location

| Platform | Path |
|---|---|
| Linux (AppImage / portable) | `$LOCKPIN_DATA_DIR` if set, otherwise next to the `.AppImage` |
| Linux (other) | `$XDG_DATA_HOME/lockpin` (default `~/.local/share/lockpin`), directory `0700`, files `0600` |
| Windows | Next to the executable when that folder is writable or already holds a vault (portable); otherwise `%APPDATA%\LockPin` (installed under `Program Files`) |

Files are written atomically (temporary file + rename), so removing the drive mid-save keeps the previous version intact.

### Portable (removable drive, Windows + Linux)

`code\docker-dev.ps1 portable` builds `build-portable/LockPin/` with `LockPin.exe`, `LockPin.AppImage` and `LockPin.sh`. Copy the folder to the drive: both systems share the same vault in that folder. On Windows run `LockPin.exe`; on Linux run `sh LockPin.sh` (works without FUSE and on drives mounted `noexec`). Windows Hello unlock only works on the PC where it was enabled; elsewhere use the master password.

### Build from source

**Prerequisites**

- [Node.js 18+](https://nodejs.org)
- [Rust 1.80+](https://rustup.rs)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

On Debian/Ubuntu:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential file
```

```bash
git clone https://github.com/sdtx-git/LockPin.git
cd LockPin

npm install
npm run tauri:build
```

The installer is output to `src-tauri/target/release/bundle/`.

### CI / Releases

Pushing a tag triggers the GitHub Actions build pipeline, which compiles on clean Linux and Windows runners, publishes the installers to GitHub Releases and assembles the portable zip from both builds:

```bash
git tag v3.0.1
git push origin v3.0.1
```

### Useful scripts

```bash
npm run typecheck     # TypeScript check (no emit)
npm run lint          # ESLint
npm run test          # Vitest unit tests
cargo check           # Rust type check (run inside src-tauri/)
```

### Docker (development on Windows)

Build, test and run the app without installing Node or Rust on the host. The GUI opens through WSLg.

```powershell
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 build   # build the dev image (once)
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 test    # sync code + typecheck, vitest, cargo check, cargo test
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 run     # sync code + tauri dev (window via WSLg)
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 sync    # push edits into the running container (hot reload)
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 shell   # bash inside the container
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 down    # remove the container (volumes are kept)
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 android-init  # regenerate src-tauri/gen/android
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 apk     # debug APK (arm64) into build-android/
powershell -ExecutionPolicy Bypass -File code\docker-dev.ps1 portable  # LockPin.exe + LockPin.AppImage into build-portable/LockPin/
```

Source code is copied into the container (no bind mount), so run `sync` after editing. Test vault data lives in the `lockpin-data` volume, isolated from the host.

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

- [x] Linux support
- [x] Portable mode (one USB folder for Windows and Linux)
- [ ] Android (mobile layout done; release build pending)
- [ ] Sync between desktop and phone over the local network, end-to-end encrypted, no cloud
- [ ] Code-signed Windows builds
- [ ] macOS support
- [ ] Biometric unlock on Linux
- [ ] Browser extension (autofill)
- [ ] Encrypted export / import (Bitwarden-compatible format)
- [ ] Password sharing via encrypted QR code
- [ ] YubiKey as second factor

---

## License

MIT © 2025 — see [LICENSE](LICENSE) for details.
