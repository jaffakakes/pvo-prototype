use crate::{compile_component, parse_structure};

/// Browser boundary: the same JSON contract is available to native tests and WASM callers.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn parse_structure_json(source: &str) -> String {
    match parse_structure(source) {
        Ok(component) => serde_json::json!({ "ok": true, "component": component }).to_string(),
        Err(diagnostic) => serde_json::json!({ "ok": false, "diagnostic": diagnostic }).to_string(),
    }
}

/// Browser boundary for a complete Structure / Style / Logic component.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn compile_component_json(kind: &str, structure: &str, style: &str, logic: &str) -> String {
    match compile_component(kind, structure, style, logic) {
        Ok(compiled) => serde_json::json!({ "ok": true, "compiled": compiled }).to_string(),
        Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
    }
}

/// Host-side capability check for a compiled PVO-language component. The
/// player calls this again when an event arrives, even after compilation.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn action_allowed(kind: &str, method: &str) -> bool {
    crate::logic::action_allowed(kind, method)
}
