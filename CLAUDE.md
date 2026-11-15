# AGENTS.md

## Project Overview
Chandelier UI is a desktop AI chat client built on Tauri 2.0, developed as part of Project Automata.
It aims to be a lightweight, highly extensible application that can use a variety of language models through OpenAI-compatible APIs.

## Development Environment & Commands
The app uses Tauri 2.0, with React + TypeScript for the frontend and Shadcn/ui for UI components. The package manager is pnpm.

### Setup
```bash
# If nightly rustfmt is not installed
rustup toolchain install nightly --profile minimal
rustup component add rustfmt --toolchain nightly

# If Just is not installed (details: https://github.com/casey/just#packages)
cargo install just

# If pnpm is not installed (details: https://pnpm.io/installation)
npx get-pnpm
```

### Basic Operations

| Command | Purpose |
| --- | --- |
| `just` | List available commands |
| `just install` | Install frontend dependencies according to the lockfile |
| `just dev` | Launch the desktop app in development mode (Vite starts automatically) |
| `just build` | Build the frontend, desktop app, and installers |
| `just web-dev` | Start only the frontend dev server |
| `just web-build` | Type-check and build the frontend |
| `just preview` | Preview the built frontend |

Do not add `run` to `just dev` or `just build`. Tauri features are not available in the browser preview.

### Build Options

| Command | Purpose |
| --- | --- |
| `just build --no-bundle` | Build only the executable, without installers |
| `just build --bundles nsis` | Create a Windows NSIS installer |
| `just build --bundles msi` | Create a Windows MSI installer |
| `just build --debug` | Debug build |
| `just build --verbose` | Output verbose logs |

Normal release output goes to `src-tauri/target/release/`, and installers are under its `bundle/` directory.

### Verification & Formatting

| Command | Purpose |
| --- | --- |
| `just check` | Run type, lint, format, and Rust static checks together (does not include tests) |
| `just typecheck` | TypeScript type check |
| `just lint` | Frontend ESLint check |
| `just web-test` | Frontend tests |
| `just rust-check` | Compile check for the Rust workspace |
| `just rust-test` | Rust tests |
| `just clippy` | Rust lint (warnings are treated as errors) |
| `just fmt` | Format and overwrite frontend and Rust files |
| `just fmt-check` | Check formatting without modifying files |
| `just deny` | Check Rust dependencies for vulnerabilities, licenses, etc. |

`just fmt` and `just fmt-check` require nightly rustfmt. `just deny` requires `cargo install cargo-deny` separately, as well as network access to the advisory DB.

## PR & Commit Conventions
Write in English.
