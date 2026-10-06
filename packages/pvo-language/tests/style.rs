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
fn compiles_bounded_spacing_type_and_shadow() {
    let css = compile(
        "choice { padding: 0; gap: 12px; border-width: 0px; box-shadow: none; } \
         prompt { letter-spacing: 2px; line-height: 1.3; text-transform: uppercase; } \
         option { padding: 14px; box-shadow: 0px 8px 20px #0008; }",
    )
    .unwrap();
    assert!(css.contains("gap:12px;"));
    assert!(css.contains("box-shadow:0px 8px 20px #0008;"));
    assert!(css.contains("text-transform:uppercase;"));
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
    for declaration in [
        "padding: 41px",
        "gap: 33px",
        "border-width: 9px",
        "letter-spacing: -1px",
        "line-height: 3",
        "text-transform: rotate",
        "box-shadow: 0px 20px 0px #000",
        "box-shadow: 0px 8px 25px #000",
        "box-shadow: 0px 8px 20px url(https://example.test/a.png)",
    ] {
        assert!(
            compile(&format!("option {{ {declaration}; }}")).is_err(),
            "{declaration}"
        );
    }
}
