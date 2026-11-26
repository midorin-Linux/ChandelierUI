fn main() {
    println!("cargo:rerun-if-changed=migrations");
    // `tests/` binaries link Tauri's Windows UI code, which needs Common Controls v6.
    // `tauri-build` declares that dependency only in the app's own manifest, so they
    // would otherwise fail to start (STATUS_ENTRYPOINT_NOT_FOUND).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::build()
}
