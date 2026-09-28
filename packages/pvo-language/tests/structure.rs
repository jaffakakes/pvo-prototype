use pvo_language::{parse_structure, parse_structure_json, Component, FieldKind};

fn rejects(source: &str, code: &str) {
    let diagnostic = parse_structure(source).expect_err("source should be rejected");
    assert_eq!(diagnostic.code, code, "{source}: {}", diagnostic.message);
    assert!(diagnostic.line > 0 && diagnostic.column > 0);
}

#[test]
fn parses_the_four_component_shapes() {
    assert_eq!(
        parse_structure("<tooltip><text>Look here</text></tooltip>").unwrap(),
        Component::Tooltip {
            text: "Look here".into()
        },
    );

    let card = parse_structure(
        r#"
        <card>
          <title>Plan</title><body>Pick a route</body>
          <button id="continue">Continue</button>
          <button id="details">Details</button>
        </card>
    "#,
    )
    .unwrap();
    let Component::Card {
        title,
        body,
        buttons,
    } = card
    else {
        panic!("expected card")
    };
    assert_eq!(title.as_deref(), Some("Plan"));
    assert_eq!(body.as_deref(), Some("Pick a route"));
    assert_eq!(
        buttons
            .iter()
            .map(|button| button.id.as_str())
            .collect::<Vec<_>>(),
        ["continue", "details"]
    );

    let choice = parse_structure(r#"<choice><prompt>Which way?</prompt><option id="left">Left</option><option id="right">Right</option></choice>"#).unwrap();
    let Component::Choice { prompt, options } = choice else {
        panic!("expected choice")
    };
    assert_eq!(prompt, "Which way?");
    assert_eq!(options.len(), 2);

    let form = parse_structure(r#"<form><field name="visitor" kind="name"/><field name="contact" kind="email"/><submit>Send</submit></form>"#).unwrap();
    let Component::Form { fields, submit, .. } = form else {
        panic!("expected form")
    };
    assert_eq!(fields[0].kind, FieldKind::Name);
    assert_eq!(fields[1].kind, FieldKind::Email);
    assert_eq!(submit, "Send");
}

#[test]
fn tooltip_is_display_only() {
    rejects(
        "<tooltip><button id=\"go\">Go</button></tooltip>",
        "invalid_child",
    );
    rejects(
        "<tooltip><a href=\"https://example.com\">Link</a></tooltip>",
        "invalid_child",
    );
    rejects(
        "<tooltip><text onclick=\"go()\">Tap</text></tooltip>",
        "invalid_attribute",
    );
    rejects(
        "<tooltip><text>One</text><text>Two</text></tooltip>",
        "duplicate_element",
    );
    rejects("<tooltip></tooltip>", "missing_element");
}

#[test]
fn cards_and_choices_have_only_their_own_controls() {
    rejects("<card><option id=\"x\">X</option></card>", "invalid_child");
    rejects(
        "<card><button id=\"x\">X</button></card>",
        "missing_element",
    );
    rejects(
        "<choice><button id=\"x\">X</button></choice>",
        "invalid_child",
    );
    rejects(
        "<choice><prompt>Pick</prompt><option id=\"x\">X</option></choice>",
        "missing_element",
    );
    rejects("<choice><prompt>Pick</prompt><option id=\"x\">X</option><option id=\"x\">Y</option></choice>", "duplicate_id");
    rejects("<card><button id=\"a\">A</button><button id=\"b\">B</button><button id=\"c\">C</button></card>", "too_many_buttons");
    rejects("<choice><prompt>Pick</prompt><option id=\"a\">A</option><option id=\"b\">B</option><option id=\"c\">C</option><option id=\"d\">D</option><option id=\"e\">E</option></choice>", "too_many_options");
}

#[test]
fn forms_require_supported_unique_fields_and_submit() {
    rejects("<form><submit>Send</submit></form>", "missing_element");
    rejects(
        "<form><field name=\"a\" kind=\"email\"/></form>",
        "missing_element",
    );
    rejects(
        "<form><field name=\"a\" kind=\"password\"/><submit>Send</submit></form>",
        "invalid_field_kind",
    );
    rejects("<form><field name=\"a\" kind=\"name\"/><field name=\"a\" kind=\"short\"/><submit>Send</submit></form>", "duplicate_id");
    rejects(
        "<form><field name=\"a\" kind=\"short\"></field><submit>Send</submit></form>",
        "invalid_structure",
    );
    rejects("<form><field name=\"a\" kind=\"short\"/><button id=\"go\">Go</button><submit>Send</submit></form>", "invalid_child");
}

#[test]
fn malformed_or_unsafe_structure_is_rejected() {
    rejects("<card><title>Hi</card>", "syntax");
    rejects(
        "<card><title><button id=\"go\">Go</button></title></card>",
        "nested_element",
    );
    rejects(
        "<card onclick=\"go()\"><title>Hi</title></card>",
        "invalid_attribute",
    );
    rejects(
        "<card><button id=\"go\" href=\"/next\">Go</button></card>",
        "invalid_attribute",
    );
    rejects("<card><body>Tea & coffee</body></card>", "syntax");
    rejects("<card><body>Tea &unknown; coffee</body></card>", "syntax");
    rejects(
        "<card><body>OK</body></card><tooltip><text>No</text></tooltip>",
        "extra_content",
    );
    rejects(
        &format!("<tooltip><text>{}</text></tooltip>", "a".repeat(20_000)),
        "source_too_large",
    );
}

#[test]
fn entities_json_and_diagnostic_positions_are_stable() {
    let source = "<tooltip>\n  <text>Tea &amp; coffee</text>\n</tooltip>";
    assert_eq!(
        parse_structure(source).unwrap(),
        Component::Tooltip {
            text: "Tea & coffee".into()
        }
    );
    let json: serde_json::Value = serde_json::from_str(&parse_structure_json(source)).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["component"]["type"], "tooltip");
    assert_eq!(json["component"]["text"], "Tea & coffee");

    let invalid = "<tooltip>\n  <text onclick=\"go()\">Tap</text>\n</tooltip>";
    let diagnostic = parse_structure(invalid).unwrap_err();
    assert_eq!((diagnostic.line, diagnostic.column), (2, 9));
    let json: serde_json::Value = serde_json::from_str(&parse_structure_json(invalid)).unwrap();
    assert_eq!(json["ok"], false);
    assert_eq!(json["diagnostic"]["code"], "invalid_attribute");
    assert_eq!(json["diagnostic"]["line"], 2);
}

#[test]
fn optional_form_presentation_extends_legacy_json_without_changing_it() {
    let old: serde_json::Value = serde_json::from_str(&parse_structure_json(
        r#"<form><field name="contact" kind="email"/><submit>Send</submit></form>"#,
    ))
    .unwrap();
    assert_eq!(
        old["component"],
        serde_json::json!({
            "type": "form", "fields": [{"name":"contact","kind":"email"}], "submit":"Send"
        })
    );
    let modern: serde_json::Value = serde_json::from_str(&parse_structure_json(
        r#"<form><heading>Reserve &amp; join</heading><field name="seats" kind="number" label="How many?"/><submit waiting="Reserving…">Reserve</submit></form>"#,
    )).unwrap();
    assert_eq!(modern["component"]["heading"], "Reserve & join");
    assert_eq!(modern["component"]["fields"][0]["kind"], "number");
    assert_eq!(modern["component"]["fields"][0]["label"], "How many?");
    assert_eq!(modern["component"]["waiting"], "Reserving…");
    rejects(
        r#"<form><heading>A</heading><heading>B</heading><field name="n" kind="number"/><submit>Send</submit></form>"#,
        "duplicate_element",
    );
    rejects(
        r#"<form><field name="n" kind="number" label=" "/><submit>Send</submit></form>"#,
        "empty_text",
    );
    rejects(
        r#"<form><heading onclick="alert()">A</heading><field name="n" kind="number"/><submit>Send</submit></form>"#,
        "invalid_attribute",
    );
}
