# Use PowerShell on Windows; keep just's default shell on other platforms.
set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

# List available commands.
default:
    @just --list

# Install frontend dependencies from the lockfile.
install:
    pnpm install --frozen-lockfile

# Run the desktop app (Tauri also starts Vite).
dev *args:
    pnpm tauri dev {{ args }}

# Build the desktop app and installers (Tauri also builds the frontend).
build *args:
    pnpm tauri build {{ args }}

# Run only the frontend development server.
web-dev *args:
    pnpm dev {{ args }}

# Type-check and build the frontend.
web-build:
    pnpm build

# Serve an existing frontend production build.
preview *args:
    pnpm preview {{ args }}

# Check frontend TypeScript types without generating files.
typecheck:
    pnpm exec tsc --noEmit

# Run ESLint on application sources.
lint:
    pnpm exec eslint src

# Format frontend files and Rust code.
fmt:
    pnpm exec prettier --write .
    cargo +nightly fmt --manifest-path src-tauri/Cargo.toml

# Check formatting without modifying files.
fmt-check:
    pnpm exec prettier --check .
    cargo +nightly fmt --manifest-path src-tauri/Cargo.toml -- --check

# Check the Rust application without producing an executable.
rust-check:
    cargo check --manifest-path src-tauri/Cargo.toml --locked

# Run Rust tests.
rust-test:
    cargo test --manifest-path src-tauri/Cargo.toml --locked

# Run Clippy and treat warnings as errors.
clippy:
    cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings

# Check Rust dependencies for advisories, licenses, bans, and sources.
deny:
    cargo deny --manifest-path src-tauri/Cargo.toml check

# Run static checks without modifying files.
check: typecheck lint fmt-check rust-check
