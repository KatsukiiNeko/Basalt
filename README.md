# Basalt

A secure, offline-first personal finance vault built with React, Vite, and the Web Crypto API. Zero-knowledge encryption, zero external network calls, zero tracking.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=for-the-badge)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white&style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-5A0FC8?logo=pwa&logoColor=white&style=for-the-badge)
![Encryption](https://img.shields.io/badge/AES--GCM--256-Encrypted-00A86B?logo=letsencrypt&logoColor=white&style=for-the-badge)
![PBKDF2](https://img.shields.io/badge/PBKDF2-600K%20Iterations-FF6B4A?style=for-the-badge)
![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB%20%2B%20Dexie-FF6B4A?style=for-the-badge)
![EWMA](https://img.shields.io/badge/Forecast-EWMA%20%2B%20IQR-4169E1?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Security Architecture](#security-architecture)
  - [Encryption Stack](#encryption-stack)
  - [Brute-Force Protection](#brute-force-protection)
  - [Backup Security](#backup-security)
  - [Currency & Display Semantics](#currency--display-semantics)
  - [Deployment Hardening](#deployment-hardening)
- [Privacy](#privacy)
- [Adaptive Forecasting Engine](#adaptive-forecasting-engine)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Basalt is a **Progressive Web App** that stores and encrypts all financial data locally on the user's device. It uses **AES-GCM-256** with keys derived from a user password via **PBKDF2 (600,000 iterations, SHA-384)**. No data ever leaves the browser — the app functions fully offline with a strict CSP that forbids any network connections.

The application supports multiple accounts, each with its own encrypted vault, and offers portable encrypted backups for cross-device migration. A built-in adaptive forecasting engine provides spending predictions using lightweight statistical methods.

---

## Key Features

- **End-to-end encryption** — AES-GCM-256, unique IV per transaction, authenticated encryption
- **Multi-account support** — separate encrypted vaults per account
- **Portable encrypted backups** — cross-device backup/restore with password-based encryption
- **Adaptive forecasting** — EWMA (α=0.3) + IQR outlier filtering + fixed-bill detection + user-correctable predictions
- **Installable PWA** — works offline like a native app
- **Dark/Light theme** — system-aware with manual toggle
- **Zero network footprint** — `connect-src 'none'` CSP, no analytics, no telemetry
- **Explicit VND display modes** — first-run choice between Full VND (1.250.000 VND) and Thousand VND (1.250K VND, the K marks thousands); changeable anytime in Settings with a live example; stored values are unit-neutral either way
- **186 automated tests** — crypto round-trips, forecasting, lockout escalation, DB migrations, account isolation, backup restore, service layer, full i18n surface (Vitest + fake-indexeddb)

---

## Security Architecture

Basalt is engineered with a **zero-knowledge** model: the server (there isn't one) never sees your data, and even the browser cannot decrypt without your password.

### Encryption Stack

| Layer | Implementation | Details |
|-------|---------------|---------|
| **Key Derivation** | PBKDF2-SHA384 | 600,000 iterations (OWASP 2023+) |
| **Symmetric Cipher** | AES-GCM-256 | Authenticated encryption, unique 12-byte IV per operation |
| **Salt** | 16 bytes CSPRNG | Per-account, stored in IndexedDB |
| **Verification** | Encrypted known-plaintext | `BASALT_VERIFY_v1` token |
| **Session Keys** | In-memory only | Never persisted, cleared on lock/timeout |

### Brute-Force Protection

| Mechanism | Implementation |
|-----------|---------------|
| **Exponential lockout** | 5 attempts = 30s, 10 = 2min, 15 = 5min, 20+ = 10min |
| **Dual persistence** | Lockout state in both localStorage and IndexedDB |
| **Cumulative tracking** | Attempts survive page refresh and IndexedDB wipe |
| **Password change cooldown** | 30s after 3 failed attempts |
| **Session timeout** | 15-minute inactivity auto-lock |

### Backup Security

| Format | Encryption | Portable | Use Case |
|--------|-----------|----------|----------|
| **v2 Quick** | Session key (AES-GCM) | No | Same device, same password |
| **v3 Secure** | Password-derived key (PBKDF2 600K + AES-GCM) | Yes | Cross-device transfer |

Secure backups encrypt raw transaction data with a fresh salt and a user-supplied password. Backup files never contain the account password. Rows that fail decryption during export are skipped and reported in the backup metadata.

**Backup Restore Protection** adds another layer:

| Mechanism | Implementation |
|-----------|---------------|
| **Triple-store lockout** | IndexedDB + localStorage + sessionStorage cross-validated |
| **Backup-file fingerprinting** | SHA-256 fingerprint binds lockout to specific backup file |
| **Escalating PBKDF2 cost** | Iterations increase per failure tier (2x → 50x) |
| **Proof-of-work gate** | SHA-256 PoW challenge after 10+ failed attempts (5–60s forced computation) |
| **Session hard cap** | 20 attempts per browser tab, stored in sessionStorage |
| **Per-backup isolation** | Different backup files have independent lockout counters |

| Failure Tier | Lockout | PBKDF2 Multiplier | Effective Iterations |
|-------------|---------|-------------------|---------------------|
| 0–4 | None | 1x | 600K |
| 5 | 30s | 2x | 1.2M |
| 8 | 2min | 5x | 3M |
| 12 | 5min | 10x | 6M |
| 16 | 10min | 20x | 12M |
| 20+ | 30min | 50x | 30M |

### Currency & Display Semantics

Stored amounts are **unit-neutral integers** — the database never records a display unit. Scaling occurs only at render time via `formatMoney()`.

| Mode | Stored `50` renders as | Behavior |
|------|------------------------|----------|
| VND + Full | `50 VND` | Verbatim |
| VND + Thousand (legacy default) | `50,000 VND` | ×1000 at render only |
| USD | `50.00 USD` | Verbatim, 2 decimals |

The choice is made at first-run onboarding and can be changed later without rewriting any stored data.

### Deployment Hardening

| Header | Value |
|--------|-------|
| Content-Security-Policy | `default-src 'self'; script-src 'self'; connect-src 'none'; frame-ancestors 'none'` |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Strict-Transport-Security | max-age=31536000; includeSubDomains |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |

**Build Security**:
- Source maps disabled in production
- Console/debugger statements stripped via Terser
- Content-hashed filenames for cache busting
- No external dependencies beyond React and Dexie

---

## Privacy

Basalt is built on a **zero-knowledge, zero-network** architecture:

| Privacy Guarantee | How |
|---|---|
| **No network calls** | CSP `connect-src 'none'` — the browser physically cannot make outbound requests |
| **No analytics** | No Google Analytics, no Mixpanel, no Sentry, no tracking pixels |
| **No telemetry** | No phone-home, no crash reports, no usage data collection |
| **No cookies** | Zero cookies used — all state is in IndexedDB and localStorage |
| **No external scripts** | No CDNs, no Google Fonts loaded at runtime — fully self-contained |
| **No server** | All data processing happens on your device — there is no backend |
| **No account creation** | No email, no phone number, no sign-up — just set a password and go |
| **No data export** | Your data never leaves your browser unless you explicitly export a backup |
| **Encrypted at rest** | Every transaction is AES-256-GCM encrypted in IndexedDB |
| **Session auto-lock** | Keys are wiped from memory after 15 minutes of inactivity |

Your financial data exists **only on your device**. If you lose access, there is no recovery server — your backup file is the only way to restore.

---

## Adaptive Forecasting Engine

Three lightweight statistical tools work together in **O(n) time**:

| Layer | Technique | Purpose |
|-------|-----------|---------|
| **Outlier Removal** | IQR (1.5x interquartile range) | Filters extreme one-off expenses before averaging (≥8 data points) |
| **Spending Rate (current month)** | EWMA (α=0.3) | Recency-biased exponential moving average on daily totals |
| **Spending Rate (past months)** | Simple mean | Average of daily spending for completed months |
| **Fixed Bills** | Historical median | Projects unpaid recurring obligations |
| **User Correction** | Ratio calibration | Click to correct predictions; stored ratio calibrates future forecasts |

**Data readiness**: Current month uses EWMA (α=0.3) and requires logged days ≥ best prior month's logged days. Past months use simple average of actual spending and require ≥1 day with variable expenses. No predictions shown when data is insufficient.

No ML. No external libraries. Just math that runs in microseconds.

---

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | React | 19.2.6 |
| Build Tool | Vite (rolldown) | 8.0.13 |
| Database | Dexie.js (IndexedDB) | 4.4.2 |
| Encryption | Web Crypto API | Native |
| Charts | Apache ECharts | tree-shaken imports only |
| Testing | Vitest + fake-indexeddb | dev-only |
| Styling | CSS3 + Custom Properties | Native |
| PWA | Service Worker + Manifest | Native |
| Forecasting | EWMA + IQR | Custom |
| Dependencies | 4 runtime (react, react-dom, dexie, echarts) | Minimal |

---

## Project Structure

```
src/
├── components/
│   ├── AccountSelector.jsx    # Multi-account creation/selection/deletion
│   ├── BackupRestore.jsx      # Encrypted backup/restore with lockout integration
│   ├── ChartsSection.jsx      # ECharts visualizations (trend/category breakdown)
│   ├── ConfirmDialog.jsx      # Confirmation modal
│   ├── CurrencyToggle.jsx     # Currency toggle
│   ├── Dashboard.jsx          # Main dashboard with balance, form, history, forecast
│   ├── ErrorBoundary.jsx      # Catches render errors instead of white-screening
│   ├── Forecast.jsx           # Monthly forecast display
│   ├── History.jsx            # Transaction history with delete
│   ├── LanguageToggle.jsx     # Language toggle
│   ├── LockScreen.jsx         # PIN entry with exponential lockout
│   ├── MonthPicker.jsx        # Month/year navigation with data-aware highlighting
│   ├── OnboardingOverlay.jsx  # First-run wizard: language → currency → VND mode
│   ├── PasswordManager.jsx    # Change password with full re-encryption
│   ├── SettingsPanel.jsx      # Grouped settings (profile/currency/security/about)
│   ├── ThemeToggle.jsx        # Dark/light toggle
│   └── TransactionForm.jsx    # Add transaction form
├── context/
│   ├── CurrencyContext.jsx    # Currency + VND display mode, exposes formatCurrency()
│   ├── LanguageContext.jsx    # i18n with localStorage
│   └── ThemeContext.jsx       # Theme state with localStorage
├── crypto/
│   ├── constants.js           # PBKDF2_ITERATIONS and other tuned parameters
│   ├── primitives.js          # Raw WebCrypto ops: deriveKey, encrypt/decrypt, constant-time equals
│   ├── sessionKeys.js         # In-memory per-account key registry (never persisted)
│   ├── transactionCrypto.js   # Verification tokens + per-transaction encrypt/decrypt
│   ├── backupService.js       # Backup create/parse/restore flows (DB-aware)
│   └── crypto.js              # Public facade re-exporting the modules above
├── services/                  # Application layer — the ONLY code touching vault data
│   ├── transactions.js        # load/add/update/delete/summary (single decrypt pass)
│   ├── auth.js               # unlock, setup, shared corruption-aborting rekey
│   ├── backup.js             # quick-backup create/restore
│   └── errors.js             # typed SessionExpiredError
├── hooks/
│   └── useVaultData.js       # one decrypted vault load, shared by all panels
├── db/
│   └── db.js                  # Dexie schema v1–v4 with migrations
├── i18n/
│   └── translations.js        # EN/VI translation strings (single keyed table)
├── utils/
│   ├── chartData.js           # Aggregation for chart inputs
│   ├── currency.js            # formatMoney() — single money-formatting authority
│   ├── forecast.js            # EWMA + IQR forecasting engine with user correction
│   └── lockout.js             # Triple-store anti-brute-force system
├── App.jsx                    # Root component with session timeout
├── index.css                  # Full application stylesheet
└── main.jsx                   # Entry point, SW registration, context providers

tests/                         # Vitest suites (not bundled)
├── setup.js                   # fake-indexeddb/auto bootstrap
├── smoke.test.js              # Test pipeline sanity
├── crypto.test.js             # Derive/encrypt/decrypt round-trips, verification token
├── forecast.test.js           # EWMA, IQR filtering, insufficient-data paths
├── lockout.test.js            # Tiers, persistence, PoW, legacy unlock-state merge
├── dbMigrations.test.js       # v2→v3 single-account migration paths, fresh install
├── accountIsolation.test.js   # Scoped queries + cross-key GCM rejection
├── authService.test.js        # Unlock/setup/change-password/PBKDF2-upgrade; rekey aborts on corruption
├── transactionService.test.js # Service writes, account-scope preservation, summary
├── secureBackup.test.js       # Real-Dexie backup create→parse→restore, corruption reporting
├── transactionEditing.test.js # Encrypted edit round-trip, no duplicate rows
├── currency.test.js           # All display-mode strings pinned
├── moneyInput.test.js         # Draft sanitization, caret math
└── configPersistence.test.js  # Onboarding keys, format matrix, i18n surface completeness

docs/decisions/                # Decision Records (DR-0001…DR-0008)
```

All components import crypto through the `crypto.js` facade; only the facade's named exports are public. The service layer (`src/services/`) owns all DB access for its domains — components never talk to Dexie directly for vault data, auth, or backups.

---

## Getting Started

```bash
# Clone
git clone https://github.com/KatsukiiNeko/Basalt.git
cd Basalt

# Install
npm install

# Develop
npm run dev

# Build
npm run build

# Preview
npm run preview
```

---

## Testing

The suite runs on Vitest with jsdom; `tests/setup.js` loads `fake-indexeddb/auto`, so Dexie code (including backup/restore flows) is tested against a real IndexedDB implementation rather than mocks.

```bash
npm test        # watch mode
npm run test:run # single run (CI)
```

Coverage priorities per the V2 brief: crypto round-trips and wrong-password rejection, forecast edge cases (EWMA, IQR outliers, insufficient data), lockout escalation and persistence, database schema/migrations/account isolation, and the full secure-backup lifecycle. Integration tests use low PBKDF2 iteration counts for speed; production constants are pinned by assertion so an accidental change fails the suite.

Architecture decisions behind non-trivial changes live in `docs/decisions/` — start there before changing crypto (`DR-0002` constant-time verification), currency semantics (`DR-0003` unit-neutral storage, `DR-0007` scaled-mode K marker), lockout behavior (`DR-0006` unlock unification), the service layer (`DR-0005`), the schema, or the bundle layout (`DR-0008` lazy ECharts).

---

## Contributing

Pull requests, issues, and feature suggestions are welcome.

```bash
git checkout -b feature/amazing-feature
git commit -m 'Add amazing feature'
git push origin feature/amazing-feature
# Open a Pull Request
```

---

## License

MIT License. See `LICENSE` for details.

---

© 2026 Katsukii Neko. All rights reserved.