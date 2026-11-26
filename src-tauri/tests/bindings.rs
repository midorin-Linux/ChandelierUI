//! Regenerates `src/bindings.ts` and fails if that changed it, so a stale file fails
//! `cargo test` (and CI) while a second run passes on the regenerated file.

#[test]
fn bindings_are_up_to_date() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts");
    let before = std::fs::read_to_string(path).unwrap_or_default();
    chandelier_ui_lib::specta_builder()
        // Timestamps (Unix ms) and token counts stay far below 2^53, so `number` is exact.
        .dangerously_cast_bigints_to_number()
        .export(specta_typescript::Typescript::default(), path)
        .expect("could not export TypeScript bindings");
    let after = std::fs::read_to_string(path).expect("could not read the exported bindings");
    assert!(
        before == after,
        "src/bindings.ts was out of date and has been regenerated; review and commit it"
    );
}
