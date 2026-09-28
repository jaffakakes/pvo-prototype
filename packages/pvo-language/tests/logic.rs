use pvo_language::{parse_logic, Action, Button, Component, OptionItem};

fn choice() -> Component {
    Component::Choice {
        prompt: "Pick".into(),
        options: vec![
            OptionItem {
                id: "first".into(),
                label: "First".into(),
            },
            OptionItem {
                id: "second".into(),
                label: "Second".into(),
            },
        ],
    }
}

#[test]
fn choice_rules_choose_direct_outcomes() {
    let rules = parse_logic(
        "on choose(first) { go_to_scene(\"branch\"); } on choose(second) { continue(); }",
        &choice(),
    )
    .unwrap();
    assert_eq!(
        rules[0].action,
        Action::Scene {
            scene_id: "branch".into()
        }
    );
    assert_eq!(rules[1].action, Action::Continue);
    assert_eq!(
        serde_json::to_value(&rules[0].action).unwrap(),
        serde_json::json!({"kind":"scene","sceneId":"branch"})
    );
    assert_eq!(
        parse_logic(
            "on choose(first) { pick(0); } on choose(second) { continue(); }",
            &choice()
        )
        .unwrap_err()
        .code,
        "action_not_allowed"
    );
}

#[test]
fn all_interactive_kinds_can_use_direct_outcomes() {
    let card = Component::Card {
        title: Some("Hi".into()),
        body: None,
        buttons: vec![Button {
            id: "next".into(),
            label: "Next".into(),
        }],
    };
    assert_eq!(
        parse_logic("on press(next) { jump_to(2.5); }", &card).unwrap()[0].action,
        Action::Time { t: 2.5 }
    );
    let form = Component::Form {
        heading: None,
        fields: vec![],
        submit: "Send".into(),
        waiting: None,
    };
    assert_eq!(
        parse_logic("on submit { continue(); }", &form).unwrap()[0].action,
        Action::Continue
    );
    let tooltip = Component::Tooltip { text: "Hi".into() };
    assert!(parse_logic("", &tooltip).unwrap().is_empty());
    assert_eq!(
        parse_logic("on submit { continue(); }", &tooltip)
            .unwrap_err()
            .code,
        "event_not_allowed"
    );
}

#[test]
fn request_is_typed_and_bounded() {
    let json = r#"{"url":"https://example.com/api","method":"POST","body":"{\"ok\":true}","onSuccess":{"kind":"time","t":3},"onError":{"kind":"scene","sceneId":"backup"}}"#;
    let logic =
        format!("on choose(first) {{ request({json}); }} on choose(second) {{ continue(); }}");
    let rules = parse_logic(&logic, &choice()).unwrap();
    assert_eq!(
        serde_json::to_value(&rules[0].action).unwrap(),
        serde_json::json!({
            "kind":"request", "url":"https://example.com/api", "method":"POST", "body":"{\"ok\":true}",
            "onSuccess":{"kind":"time","t":3.0}, "onError":{"kind":"scene","sceneId":"backup"},
        })
    );
    for bad in [
        r#"{"url":"javascript:alert(1)","method":"GET","body":"","onSuccess":{"kind":"continue"},"onError":null}"#,
        r#"{"url":"https://user@example.com/api","method":"GET","body":"","onSuccess":{"kind":"continue"},"onError":null}"#,
        r#"{"url":"https://example.com/api","method":"DELETE","body":"","onSuccess":{"kind":"continue"},"onError":null}"#,
        r#"{"url":"https://example.com/api","method":"POST","body":"not json","onSuccess":{"kind":"continue"},"onError":null}"#,
        r#"{"url":"https://example.com/api","method":"GET","body":"","onSuccess":{"kind":"time","t":-1},"onError":null}"#,
        r#"{"url":"https://example.com/api","method":"GET","body":"","onSuccess":{"kind":"scene","sceneId":""},"onError":null}"#,
        r#"{"url":"https://example.com/api","method":"GET","body":"","onSuccess":{"kind":"continue","x":1},"onError":null}"#,
    ] {
        let logic =
            format!("on choose(first) {{ request({bad}); }} on choose(second) {{ continue(); }}");
        assert_eq!(
            parse_logic(&logic, &choice()).unwrap_err().code,
            "invalid_request",
            "{bad}"
        );
    }
}

#[test]
fn every_control_needs_one_rule() {
    assert_eq!(
        parse_logic("on choose(first) { continue(); }", &choice())
            .unwrap_err()
            .code,
        "missing_handler"
    );
    assert_eq!(
        parse_logic(
            "on choose(first) { continue(); } on choose(first) { continue(); }",
            &choice()
        )
        .unwrap_err()
        .code,
        "duplicate_handler"
    );
    assert_eq!(
        parse_logic("on choose(missing) { continue(); }", &choice())
            .unwrap_err()
            .code,
        "unknown_control"
    );
}
