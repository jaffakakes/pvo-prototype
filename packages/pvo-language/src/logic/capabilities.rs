/// Host-side capability check for a compiled PVO-language component. The
/// player calls this again when an event arrives, even after compilation.
pub fn action_allowed(kind: &str, method: &str) -> bool {
    match kind {
        "tooltip" => false,
        "card" => method == "pick",
        "choice" => method == "pick",
        "form" => method == "submit",
        _ => false,
    }
}
