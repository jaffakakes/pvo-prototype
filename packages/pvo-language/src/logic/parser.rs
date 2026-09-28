use std::collections::HashSet;

use super::cursor::Cursor;
use super::model::{Action, Rule};
use super::validation::{request_action, valid_scene_id};
use crate::{Component, Diagnostic};

const MAX_LOGIC_BYTES: usize = 20_000;

/// Parse bounded event rules. Only declared controls may emit events; the
/// action is a typed outcome interpreted by the trusted editor/player host.
pub fn parse_logic(source: &str, component: &Component) -> Result<Vec<Rule>, Diagnostic> {
    if source.len() > MAX_LOGIC_BYTES {
        return Err(Diagnostic::at(
            source,
            0,
            "logic_too_large",
            "PVO Logic is limited to 20,000 bytes.",
        ));
    }
    let (event, targets): (&str, Vec<String>) = match component {
        Component::Tooltip { .. } => ("", Vec::new()),
        Component::Card { buttons, .. } => (
            "press",
            buttons.iter().map(|item| item.id.clone()).collect(),
        ),
        Component::Choice { options, .. } => (
            "choose",
            options.iter().map(|item| item.id.clone()).collect(),
        ),
        Component::Form { .. } => ("submit", Vec::new()),
    };
    if matches!(component, Component::Tooltip { .. }) && !source.trim().is_empty() {
        return Err(Diagnostic::at(
            source,
            0,
            "event_not_allowed",
            "Tooltip is display-only and has no Logic events.",
        ));
    }
    let mut cursor = Cursor::new(source);
    let mut rules = Vec::new();
    let mut seen = HashSet::new();
    loop {
        cursor.whitespace();
        if cursor.offset == source.len() {
            break;
        }
        cursor.expect_word("on")?;
        cursor.expect_word(event)?;
        let target = if event == "submit" {
            None
        } else {
            cursor.expect('(')?;
            let id = cursor
                .word()
                .ok_or_else(|| cursor.error("logic_syntax", "Expected a control ID."))?;
            cursor.expect(')')?;
            if !targets.contains(&id) {
                return Err(cursor.error(
                    "unknown_control",
                    format!("'{id}' is not a control in this component."),
                ));
            }
            Some(id)
        };
        if !seen.insert(target.clone()) {
            return Err(cursor.error(
                "duplicate_handler",
                "Each control can have only one handler.",
            ));
        }
        cursor.expect('{')?;
        let action_name = cursor
            .word()
            .ok_or_else(|| cursor.error("logic_syntax", "Expected an approved action."))?;
        cursor.expect('(')?;
        let action = match action_name.as_str() {
            "continue" => Action::Continue,
            "jump_to" => Action::Time {
                t: cursor.number()?,
            },
            "go_to_scene" => {
                let scene_id = cursor.quoted()?;
                if !valid_scene_id(&scene_id) {
                    return Err(cursor.error(
                        "logic_argument",
                        "Use a nonempty scene ID of at most 128 bytes.",
                    ));
                }
                Action::Scene { scene_id }
            }
            "request" => {
                let at = cursor.offset;
                let json = cursor.json_object()?;
                request_action(source, at, json)?
            }
            _ => {
                return Err(cursor.error(
                    "action_not_allowed",
                    format!("'{action_name}' is not an approved outcome action."),
                ))
            }
        };
        cursor.expect(')')?;
        cursor.expect(';')?;
        cursor.expect('}')?;
        rules.push(Rule {
            event: event.to_owned(),
            target,
            action,
        });
    }
    let expected = if event == "submit" { 1 } else { targets.len() };
    if rules.len() != expected {
        return Err(Diagnostic::at(
            source,
            0,
            "missing_handler",
            format!("Add one {event} handler for every control."),
        ));
    }
    Ok(rules)
}
