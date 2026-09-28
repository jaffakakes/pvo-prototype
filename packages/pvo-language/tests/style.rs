use pvo_language::{compile_style, StyleError};

fn compile(source: &str) -> Result<String, StyleError> {
    compile_style(
        source,
        &["choice", "prompt", "option"],
        &["street".to_owned()],
    )
}

#[test]
fn compiles_scoped_visual_rules() {
    let css = compile(
        "prompt { color: #111; font-size: 18px; } #street { background: rgba(1, 2, 3, .5); }",
    )
    .unwrap();
    assert_eq!(
        css,
        "#pvo-root .pvo-prompt{color:#111;font-size:18px;}\n#pvo-root [data-pvo-id=\"street\"]{background:rgba(1, 2, 3, .5);}\n"
    );
}

#[test]
fn rejects_unknown_and_nonlocal_selectors() {
    assert!(compile("#missing { color: #fff; }").is_err());
    assert!(compile("button { color: #fff; }").is_err());
    assert!(compile("prompt, option { color: #fff; }").is_err());
    assert!(compile("body prompt { color: #fff; }").is_err());
    assert!(compile("prompt:hover { color: #fff; }").is_err());
}

#[test]
fn rejects_behavioral_properties_and_resource_loading() {
    for property in [
        "display",
        "visibility",
        "position",
        "pointer-events",
        "opacity",
    ] {
        assert!(compile(&format!("option {{ {property}: none; }}")).is_err());
    }
    assert!(compile("option { background: url(https://example.test/a.png); }").is_err());
    assert!(compile("@import 'https://example.test/a.css';").is_err());
    assert!(compile("option { color: #fff !important; }").is_err());
}

#[test]
fn rejects_unsafe_or_unbounded_values() {
    assert!(compile("option { font-size: 1000px; }").is_err());
    assert!(compile("option { border-radius: -2px; }").is_err());
    assert!(compile("option { color: rgba(1,2,3,1.5); }").is_err());
    assert!(compile("option { background: linear-gradient(red, blue); }").is_err());
}
