use pvo_language::{compile_component, Action};

#[test]
fn choice_compiles_direct_outcomes_to_index_only_handlers() {
    let result = compile_component(
        "choice",
        "<choice><prompt>Which?</prompt><option id=\"a\">A</option><option id=\"b\">B</option></choice>",
        "option { color: #111; }",
        "on choose(a) { go_to_scene(\"branch\"); } on choose(b) { continue(); }",
    ).unwrap();
    assert!(result.html.contains("onclick=\"pvo.pick(0)\""));
    assert!(result.html.contains("onclick=\"pvo.pick(1)\""));
    assert!(!result.html.contains("pvo.goToScene"));
    assert_eq!(
        result.rules[0].action,
        Action::Scene {
            scene_id: "branch".into()
        }
    );
    assert!(result.css.contains("#pvo-root .pvo-option{color:#111;}"));
    assert!(result.js.is_empty());
}

#[test]
fn form_reports_submit_even_when_its_rule_routes_elsewhere() {
    let result = compile_component(
        "form",
        "<form><field name=\"email\" kind=\"email\"/><submit>Send</submit></form>",
        "",
        "on submit { jump_to(5); }",
    )
    .unwrap();
    assert!(result.html.contains("onsubmit=\"pvo.submit(fields)\""));
    assert!(!result.html.contains("pvo.jumpTo"));
    assert_eq!(result.rules[0].action, Action::Time { t: 5.0 });
}

#[test]
fn wrong_root_or_forbidden_button_cannot_compile() {
    let root =
        compile_component("tooltip", "<card><title>Wrong</title></card>", "", "").unwrap_err();
    assert_eq!(root.diagnostic.code, "kind_mismatch");
    let button = compile_component(
        "tooltip",
        "<tooltip><text>Hi</text><button id=\"go\">Go</button></tooltip>",
        "",
        "",
    )
    .unwrap_err();
    assert_eq!(button.part, "structure");
}

#[test]
fn form_heading_labels_numbers_and_waiting_text_are_escaped_and_styled() {
    let result = compile_component("form",
        r#"<form><heading>&lt;script&gt;</heading><field name="amount" kind="number" label="&quot; onfocus=&quot;bad"/><submit waiting="&lt;img&gt;">Send</submit></form>"#,
        "heading { color: #FFD23E; }", "on submit { continue(); }").unwrap();
    assert!(result
        .html
        .contains("<h3 class=\"pvo-heading\">&lt;script&gt;</h3>"));
    assert!(result.html.contains("type=\"number\""));
    assert!(result.html.contains("step=\"any\""));
    assert!(result
        .html
        .contains("aria-label=\"&quot; onfocus=&quot;bad\""));
    assert!(result.html.contains("data-pvo-waiting=\"&lt;img&gt;\""));
    assert!(result.css.contains(".pvo-heading{color:#FFD23E;}"));
    assert!(!result.html.contains(" onfocus=\"bad"));
}
