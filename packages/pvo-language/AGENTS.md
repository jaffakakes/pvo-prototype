# PVO language package instructions

Read the root [agent rules](../../AGENTS.md) and this package's [ownership map](README.md) before changing the compiler.

- Keep `src/lib.rs` as the stable Rust facade, `src/bindings.rs` as the JSON/WASM boundary, and root `index.js` / `index.d.ts` as the browser facade. Preserve export names, serialization, diagnostics, and `pkg/` output paths during structural changes.
- Keep Structure, Style, and Logic rules in their respective folders. Compiler orchestration and HTML/CSS output generation belong in `src/compiler/`; host effects belong outside this package.
- Keep `wasm-bindgen` annotations in bindings. Parsing, validation, rendering, and capability rules must remain native-testable without browser dependencies.
- Preserve language limits, value allowlists, request checks, escaping, and control-event capabilities. Do not change language or security policy as part of extraction.
- Test observable behavior through the public Rust API in `tests/`. Use `cargo test --manifest-path packages/pvo-language/Cargo.toml --locked` and `cargo fmt --manifest-path packages/pvo-language/Cargo.toml -- --check` from the repository root. Verify WASM exports when changing bindings or module organization.
- `pkg/` and `target/` are generated and ignored. Never edit them as a source fix; rebuild with the package build command. Do not run the root build against dirty deployment output just to validate this package.
