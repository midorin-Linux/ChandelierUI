# Chandelier UI

Chandelier UI is a desktop AI chat client built on Tauri 2.0, developed as part of Project Automata.
It aims to be a lightweight, highly extensible application that can use a variety of language models through OpenAI-compatible APIs.

## Tech Stack
The app uses Tauri 2.0, with React + TypeScript for the frontend and Shadcn/ui for UI components. The package manager is pnpm.

## Setup
```bash
# If nightly rustfmt is not installed
rustup toolchain install nightly --profile minimal
rustup component add rustfmt --toolchain nightly

# If Just is not installed (details: https://github.com/casey/just#packages)
cargo install just

# If pnpm is not installed (details: https://pnpm.io/installation)
npx get-pnpm
```

## Basic Operations

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
