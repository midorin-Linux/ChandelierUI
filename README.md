# Chandelier UI

[![CI](https://github.com/midorin-Linux/ChandelierUI/actions/workflows/ci.yml/badge.svg)](https://github.com/midorin-Linux/ChandelierUI/actions/workflows/ci.yml)
[![Audit](https://github.com/midorin-Linux/ChandelierUI/actions/workflows/audit.yml/badge.svg)](https://github.com/midorin-Linux/ChandelierUI/actions/workflows/audit.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Chandelier UI is a desktop AI chat client built on Tauri 2.0, developed as part of [Project Automata](https://suwako.me).
It aims to be a lightweight, highly extensible application that can use a variety of language models through OpenAI-compatible APIs — local LLM servers and hosted providers alike.

> [!NOTE]
> Chandelier UI is under active development (v0.1.0) and has no stable release yet.
> Features, storage format and settings may change without notice.

<!-- TODO: add a screenshot -->
<!-- ![Chandelier UI](docs/screenshot.png) -->

## Features

- **Chat with any OpenAI-compatible API** — streaming responses via the Chat Completions API
- **Provider presets** — save multiple endpoints and switch between them; API keys are stored in the OS keyring, not in plain text
- **Per-session model settings** — model, reasoning effort and system prompt are kept per session
- **Branching conversations** — edit a message or regenerate a response to create a branch, then switch between branches
- **Persistent sessions** — sessions, settings and analysis data are saved to a local SQLite database
- **Analysis** — measure TTFT and inspect context usage for each response
- **Rich rendering** — Markdown, syntax-highlighted code and math (KaTeX)
- **Light / dark theme**

### Planned

- Session export / import (per branch), including export as a training dataset
- Open Responses API support

## Tech Stack

| Layer    | Technologies                                                                           |
| -------- | -------------------------------------------------------------------------------------- |
| App      | Tauri 2.0                                                                              |
| Backend  | Rust, sqlx (SQLite), reqwest, keyring, tauri-specta (type-safe command bindings)       |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, zustand, streamdown, shiki, KaTeX |
| Tooling  | pnpm, just, ESLint, Prettier, rustfmt (nightly), Clippy, cargo-deny                    |

## Requirements

- **Rust** (stable) — install via [rustup](https://rustup.rs/)
- **Rust nightly rustfmt** — used for formatting only
- **Node.js 26** — see `.nvmrc`
- **pnpm** — the version pinned in `package.json` `"packageManager"`
- **just** — task runner
- **Tauri system dependencies** for your OS — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  - Linux: WebKitGTK and related packages
  - Windows: Microsoft C++ Build Tools and WebView2
  - macOS: Xcode Command Line Tools

## Setup

```bash
# Rust (if not installed): https://rustup.rs/
rustup toolchain install stable

# Nightly rustfmt (formatting only)
rustup toolchain install nightly --profile minimal
rustup component add rustfmt --toolchain nightly

# just (details: https://github.com/casey/just#packages)
cargo install just

# pnpm (details: https://pnpm.io/installation)
npx get-pnpm
# pnpm does not switch versions automatically here; use the version in package.json "packageManager"

git clone https://github.com/midorin-Linux/ChandelierUI.git
cd ChandelierUI
just install
just dev run
```

## Getting Started

1. Launch the app and open **Settings → Provider**.
2. Add a provider: a name, the base URL of an OpenAI-compatible endpoint (e.g. `http://localhost:8080/v1` for a local server) and, if required, an API key.
3. Start a new chat, pick a model, and send a message.

### Where data is stored

| Data                         | Location                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Sessions, settings, analysis | `chandelier.db` (SQLite) in the app data directory for `me.suwako.chandelier-ui` |
| API keys                     | OS keyring (Windows Credential Manager / macOS Keychain / Secret Service)        |

The app data directory is typically:

- Linux: `~/.local/share/me.suwako.chandelier-ui/`
- macOS: `~/Library/Application Support/me.suwako.chandelier-ui/`
- Windows: `%APPDATA%\me.suwako.chandelier-ui\`

## Commands

Run `just` to list all commands.

### Run & build

| Command          | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `just install`   | Install frontend dependencies according to the lockfile      |
| `just dev run`   | Launch the desktop app in development mode (starts Vite too) |
| `just build`     | Build the frontend, desktop app, and installers              |
| `just web-dev`   | Start only the frontend dev server                           |
| `just web-build` | Type-check and build the frontend                            |
| `just preview`   | Preview the built frontend                                   |

### Checks & tests

| Command           | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `just check`      | Run all static checks (typecheck, lint, fmt-check, rust-check)         |
| `just typecheck`  | Type-check the frontend without emitting files                         |
| `just lint`       | Run ESLint on the whole repository                                     |
| `just fmt`        | Format frontend files and Rust code                                    |
| `just fmt-check`  | Check formatting without modifying files                               |
| `just web-test`   | Run frontend tests                                                     |
| `just rust-check` | `cargo check` all Rust crates                                          |
| `just rust-test`  | Run Rust tests                                                         |
| `just clippy`     | Run Clippy with warnings treated as errors                             |
| `just deny`       | Check Rust dependencies (advisories, licenses, bans, sources)          |
| `just bindings`   | Regenerate `src/bindings.ts` from Rust commands; fails if it was stale |

Before opening a pull request, run `just check`, `just web-test`, `just rust-test` and `just clippy`.
If you changed a Tauri command or its types, run `just bindings` and commit the updated `src/bindings.ts`.

## Project Structure

```text
.
├── src/                  # Frontend (React + TypeScript)
│   ├── components/       # UI components (chat, sidebar, settings, analysis)
│   ├── stores/           # zustand stores
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── bindings.ts       # Generated by tauri-specta — do not edit by hand
└── src-tauri/            # Backend (Rust)
    ├── src/
    │   ├── commands/     # Tauri commands (chat streaming, providers, secrets, sessions, settings, metrics)
    │   └── storage/      # SQLite persistence layer
    ├── migrations/       # Database migrations
    └── tests/
```

## Contributing

Issues and pull requests are welcome. Development guidelines for contributors (and AI coding agents) are in [AGENTS.md](AGENTS.md).

## Security

Please do not report vulnerabilities through public issues. See [SECURITY.md](SECURITY.md) for how to report them privately.

## License

Licensed under the [Apache License 2.0](LICENSE).
