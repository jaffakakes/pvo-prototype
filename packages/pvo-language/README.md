# PVO language compiler

This package validates and compiles PVO Structure, Style, and Logic for the editor and player. The Rust core returns typed data, scoped CSS, escaped HTML, and checked outcome rules. It does not execute playback or requests. Host adapters perform those effects after applying their runtime policies.

For authoring syntax, see the [PVO language guide](../../docs/language/README.md).

## Ownership

```text
src/
  lib.rs                  Stable Rust public facade
  bindings.rs             JSON envelopes and wasm-bindgen exports
  diagnostic.rs           Shared source-position diagnostics
  structure/              Component model, markup parser, shape validation
    checks.rs             Attribute, identifier, text, and uniqueness checks
    validation.rs         Tooltip, Card, Choice, and Form shape rules
  style/                  Scoped visual-rule compilation
    parser.rs             Selector/declaration syntax and source positions
    values.rs             Allowed visual properties and bounded values
  logic/                  Typed event and outcome rules
    model.rs              Action, PlaybackRoute, and Rule data contracts
    cursor.rs             Bounded token/string/JSON reading
    parser.rs             Event grammar and control-handler requirements
    validation.rs         Request, URL, scene, and route validation
    capabilities.rs       Allowed host event methods for each component kind
  compiler/               Whole-component orchestration and output generation
    metadata.rs           Component kinds and local selector identities
    render.rs             Escaped HTML and default component CSS
tests/                    Integration tests through the public Rust API
index.js / index.d.ts      Stable browser facade and TypeScript contracts
worker.js / worker.d.ts    Worker facade using a statically bundled WASM module
result.js                 Shared result and diagnostic decoding
pkg/                      Generated web-target WASM and JavaScript glue (ignored)
target/                   Cargo build output (ignored)
```

`lib.rs` retains the public Rust parsing, compilation, diagnostic, model, and capability exports. `bindings.rs` owns the `parse_structure_json`, `compile_component_json`, and `action_allowed` WASM exports. The capability rule itself lives in Logic; the binding only exposes it.

Browser consumers import `compilePvoComponent`, `isPvoLanguageActionAllowed`, and `PvoLanguageError` from the package's root `index.js`. That facade initializes `./pkg/pvo_language.js` once and exposes the compiler result or a structured error. Keep the facade path, exported names, JSON shapes, and generated `pkg/` location stable.

Cloudflare Worker consumers use the same exports from `worker.js`. Its static WASM import initializes the existing compiler once per isolate, without fetching or compiling bytes at request time. Both adapters decode the same Rust output and diagnostics through `result.js`; neither executes the returned host actions.

## Verification

Run from the repository root with a Rust toolchain installed:

```sh
cargo test --manifest-path packages/pvo-language/Cargo.toml --locked
cargo fmt --manifest-path packages/pvo-language/Cargo.toml -- --check
```

The integration suites cover Structure shapes and diagnostics, Style restrictions, Logic outcomes and request rejection, compilation output, host capability checks, and JSON binding contracts. A structural refactor should preserve diagnostic codes, messages and positions as well as successful output.

Build the browser artifacts with `wasm-pack` installed:

```sh
npm run build:language
```

This package build generates `pkg/pvo_language.js` and its `.wasm` companion. Deploy both along with the root browser facade; generated files are not source fixes. For verification that must leave existing `pkg/` output untouched, use `wasm-pack build packages/pvo-language --target web --release --out-dir <absolute-temporary-directory>`.

Native tests verify compiler rules and contracts. A WASM build also verifies the exported browser ABI. Browser workflows additionally verify editor/player initialization and sandbox integration; neither native tests nor a successful WASM build proves browser isolation or playback behavior.

## Changing the compiler

Follow the repository [coding standard](../../docs/engineering/coding-standards.md). Put grammar, limits, and validation with their owning language part. Keep `wasm-bindgen` and JSON boundary handling in `bindings.rs`, and browser initialization in `index.js`. Do not add editor/player imports, DOM operations, networking, or playback effects to Rust rules.

Preserve the separation between the renderer reporting a control event and the host executing a checked outcome. Changes to the grammar, source limits, property allowlist, request validation, output escaping, or capability policy are behavior changes and require focused regression cases; do not combine them with file moves.
