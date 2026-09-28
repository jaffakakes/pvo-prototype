use std::collections::HashSet;

use super::checks::{
    allowed_attributes, children, error, identifier, require_container, required_attribute, text,
    unique,
};
use super::model::{Button, Component, Field, FieldKind, OptionItem};
use super::parser::Element;
use crate::Diagnostic;

pub(super) fn validate(source: &str, root: &Element) -> Result<Component, Diagnostic> {
    require_container(source, root)?;
    allowed_attributes(source, root, &[])?;
    let children = children(source, root)?;
    match root.name.as_str() {
        "tooltip" => tooltip(source, root, &children),
        "card" => card(source, root, &children),
        "choice" => choice(source, root, &children),
        "form" => form(source, root, &children),
        _ => Err(error(
            source,
            root.offset,
            "invalid_root",
            "Use <tooltip>, <card>, <choice>, or <form> as the root.",
        )),
    }
}

fn tooltip(source: &str, root: &Element, children: &[&Element]) -> Result<Component, Diagnostic> {
    for child in children {
        if child.name != "text" {
            return Err(error(
                source,
                child.offset,
                "invalid_child",
                "Tooltip can contain only <text>; it cannot contain buttons or links.",
            ));
        }
    }
    if children.is_empty() {
        return Err(error(
            source,
            root.offset,
            "missing_element",
            "Tooltip needs one <text>.",
        ));
    }
    if children.len() > 1 {
        return Err(error(
            source,
            children[1].offset,
            "duplicate_element",
            "Tooltip allows only one <text>.",
        ));
    }
    Ok(Component::Tooltip {
        text: text(source, children[0], &[])?,
    })
}

fn card(source: &str, root: &Element, children: &[&Element]) -> Result<Component, Diagnostic> {
    let (mut title, mut body, mut buttons) = (None, None, Vec::new());
    let mut ids = HashSet::new();
    for child in children {
        match child.name.as_str() {
            "title" => {
                if title.is_some() {
                    return Err(error(
                        source,
                        child.offset,
                        "duplicate_element",
                        "Card allows only one <title>.",
                    ));
                }
                title = Some(text(source, child, &[])?);
            }
            "body" => {
                if body.is_some() {
                    return Err(error(
                        source,
                        child.offset,
                        "duplicate_element",
                        "Card allows only one <body>.",
                    ));
                }
                body = Some(text(source, child, &[])?);
            }
            "button" => {
                if buttons.len() == 2 {
                    return Err(error(
                        source,
                        child.offset,
                        "too_many_buttons",
                        "Card allows at most two buttons.",
                    ));
                }
                let label = text(source, child, &["id"])?;
                let id = identifier(source, required_attribute(source, child, "id")?)?;
                buttons.push(Button {
                    id: unique(source, child, &mut ids, id)?,
                    label,
                });
            }
            _ => {
                return Err(error(
                    source,
                    child.offset,
                    "invalid_child",
                    "Card allows <title>, <body>, and up to two <button> children.",
                ))
            }
        }
    }
    if title.is_none() && body.is_none() {
        return Err(error(
            source,
            root.offset,
            "missing_element",
            "Card needs a <title> or <body>.",
        ));
    }
    Ok(Component::Card {
        title,
        body,
        buttons,
    })
}

fn choice(source: &str, root: &Element, children: &[&Element]) -> Result<Component, Diagnostic> {
    let mut prompt = None;
    let mut options = Vec::new();
    let mut ids = HashSet::new();
    for child in children {
        match child.name.as_str() {
            "prompt" => {
                if prompt.is_some() {
                    return Err(error(
                        source,
                        child.offset,
                        "duplicate_element",
                        "Choice allows only one <prompt>.",
                    ));
                }
                prompt = Some(text(source, child, &[])?);
            }
            "option" => {
                if options.len() == 4 {
                    return Err(error(
                        source,
                        child.offset,
                        "too_many_options",
                        "Choice allows at most four options.",
                    ));
                }
                let label = text(source, child, &["id"])?;
                let id = identifier(source, required_attribute(source, child, "id")?)?;
                options.push(OptionItem {
                    id: unique(source, child, &mut ids, id)?,
                    label,
                });
            }
            _ => {
                return Err(error(
                    source,
                    child.offset,
                    "invalid_child",
                    "Choice allows one <prompt> and two to four <option> children.",
                ))
            }
        }
    }
    if prompt.is_none() {
        return Err(error(
            source,
            root.offset,
            "missing_element",
            "Choice needs one <prompt>.",
        ));
    }
    if options.len() < 2 {
        return Err(error(
            source,
            root.offset,
            "missing_element",
            "Choice needs at least two <option> children.",
        ));
    }
    Ok(Component::Choice {
        prompt: prompt.unwrap(),
        options,
    })
}

fn form(source: &str, root: &Element, children: &[&Element]) -> Result<Component, Diagnostic> {
    let mut heading = None;
    let mut fields = Vec::new();
    let mut submit = None;
    let mut waiting = None;
    let mut names = HashSet::new();
    for child in children {
        match child.name.as_str() {
            "heading" => {
                if heading.is_some() {
                    return Err(error(
                        source,
                        child.offset,
                        "duplicate_element",
                        "Form allows only one <heading>.",
                    ));
                }
                heading = Some(text(source, child, &[])?);
            }
            "field" => {
                if fields.len() == 20 {
                    return Err(error(
                        source,
                        child.offset,
                        "too_many_fields",
                        "Form allows at most 20 fields.",
                    ));
                }
                if !child.self_closing {
                    return Err(error(
                        source,
                        child.offset,
                        "invalid_structure",
                        "<field> must be self-closing.",
                    ));
                }
                allowed_attributes(source, child, &["name", "kind", "label"])?;
                let name = identifier(source, required_attribute(source, child, "name")?)?;
                let name = unique(source, child, &mut names, name)?;
                let kind_attribute = required_attribute(source, child, "kind")?;
                let kind = match kind_attribute.value.as_str() {
                    "name" => FieldKind::Name,
                    "email" => FieldKind::Email,
                    "phone" => FieldKind::Phone,
                    "short" => FieldKind::Short,
                    "number" => FieldKind::Number,
                    "yesno" => FieldKind::Yesno,
                    _ => {
                        return Err(error(
                            source,
                            kind_attribute.offset,
                            "invalid_field_kind",
                            "Field kind must be name, email, phone, short, number, or yesno.",
                        ))
                    }
                };
                let label = optional_form_text(source, child, "label")?;
                fields.push(Field { name, kind, label });
            }
            "submit" => {
                if submit.is_some() {
                    return Err(error(
                        source,
                        child.offset,
                        "duplicate_element",
                        "Form allows only one <submit>.",
                    ));
                }
                submit = Some(text(source, child, &["waiting"])?);
                waiting = optional_form_text(source, child, "waiting")?;
            }
            _ => {
                return Err(error(
                    source,
                    child.offset,
                    "invalid_child",
                    "Form allows an optional <heading>, <field>, and one <submit> child.",
                ))
            }
        }
    }
    if fields.is_empty() {
        return Err(error(
            source,
            root.offset,
            "missing_element",
            "Form needs at least one <field>.",
        ));
    }
    let submit = submit.ok_or_else(|| {
        error(
            source,
            root.offset,
            "missing_element",
            "Form needs one <submit>.",
        )
    })?;
    Ok(Component::Form {
        heading,
        fields,
        submit,
        waiting,
    })
}

fn optional_form_text(
    source: &str,
    element: &Element,
    name: &str,
) -> Result<Option<String>, Diagnostic> {
    let Some(attribute) = element
        .attributes
        .iter()
        .find(|attribute| attribute.name == name)
    else {
        return Ok(None);
    };
    let value = attribute.value.trim();
    if value.is_empty() {
        return Err(error(
            source,
            attribute.offset,
            "empty_text",
            format!("{name} needs text."),
        ));
    }
    Ok(Some(value.to_owned()))
}
