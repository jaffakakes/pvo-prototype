use pvo_language::{compile_component_json, parse_structure_json};
use serde_json::{json, Value};

#[test]
fn compile_success_preserves_the_browser_envelope_and_escaped_output() {
    let result: Value = serde_json::from_str(&compile_component_json(
        "tooltip",
        "<tooltip><text>Tea &amp; coffee</text></tooltip>",
        "text { color: #123; }",
        "",
    ))
    .unwrap();

    assert_eq!(result["ok"], true);
    assert_eq!(result.as_object().unwrap().len(), 2);
    let compiled = &result["compiled"];
    assert_eq!(compiled.as_object().unwrap().len(), 5);
    assert_eq!(
        compiled["structure"],
        json!({"type": "tooltip", "text": "Tea & coffee"})
    );
    assert_eq!(compiled["rules"], json!([]));
    assert_eq!(compiled["js"], "");
    assert_eq!(
        compiled["html"],
        "<div class=\"pvo-tooltip\"><span class=\"pvo-text\">Tea &amp; coffee</span></div>"
    );
    assert!(compiled["css"]
        .as_str()
        .unwrap()
        .ends_with("#pvo-root .pvo-text{color:#123;}\n"));
}

#[test]
fn compile_failure_reports_the_owning_part_and_source_position() {
    let valid_structure = "<tooltip><text>Hi</text></tooltip>";
    for (structure, style, logic, part, code, column, message) in [
        (
            "<tooltip></tooltip>",
            "",
            "",
            "structure",
            "missing_element",
            1,
            "Tooltip needs one <text>.",
        ),
        (
            valid_structure,
            "text { position: absolute; }",
            "",
            "style",
            "invalid_style",
            8,
            "'position' is not a visual property allowed by PVO Style.",
        ),
        (
            valid_structure,
            "",
            "on submit { continue(); }",
            "logic",
            "event_not_allowed",
            1,
            "Tooltip is display-only and has no Logic events.",
        ),
    ] {
        let result: Value =
            serde_json::from_str(&compile_component_json("tooltip", structure, style, logic))
                .unwrap();
        assert_eq!(
            result,
            json!({
                "ok": false,
                "error": {
                    "part": part,
                    "diagnostic": {"code": code, "message": message, "line": 1, "column": column},
                },
            }),
        );
    }
}

#[test]
fn structure_json_keeps_its_distinct_diagnostic_envelope() {
    let result: Value = serde_json::from_str(&parse_structure_json("<tooltip></tooltip>")).unwrap();
    assert_eq!(
        result,
        json!({
            "ok": false,
            "diagnostic": {
                "code": "missing_element",
                "message": "Tooltip needs one <text>.",
                "line": 1,
                "column": 1,
            },
        }),
    );
}
