# Chandelier UI

## Commands

- `just install`: install frontend dependencies from the lockfile.
- `just dev`: start the desktop app and Vite; close the app to stop.
- `just build`: build the desktop app and platform installers.
- `just web-dev`: start Vite without the desktop app.
- `just web-build`: build the frontend into `dist`.
- `just preview`: serve `dist`; run `just web-build` or `just build` first.
- `just check`: run TypeScript, ESLint, formatting, and Rust checks.
- `just rust-test` / `just clippy`: run Rust tests / Clippy.
- `just deny`: check Rust dependency advisories, licenses, bans, and sources.
- `just fmt` / `just fmt-check`: format sources / check formatting.

Prerequisites: pnpm, just, Rust with the nightly rustfmt component, and the
[Tauri platform dependencies](https://v2.tauri.app/start/prerequisites/).
Install the dependency checker with `cargo install cargo-deny --locked`.
Its license allowlist is in `src-tauri/deny.toml`; `just deny` needs network
access to refresh the advisory database and is separate from `just check`.
The app crate is not published to crates.io and is excluded from license checks;
third-party dependencies are checked. Maintenance advisories remain errors.
Keep `src-tauri/Cargo.lock`: the Rust check recipes use `--locked`.

ESLint 9 is used for compatibility with `eslint-plugin-react` 7.
The recommended React Hooks and JSX accessibility rules are also enabled.
On Windows, closing `just dev` can print a pnpm lifecycle exit code of `-1`
when Tauri stops its Vite subprocess, even though `just dev` exits with code 0.
