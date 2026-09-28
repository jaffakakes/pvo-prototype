use std::collections::HashSet;

use super::parser::{Attribute, Content, Element};
use crate::Diagnostic;

pub(super) fn error(
    source: &str,
    offset: usize,
    code: &'static str,
    message: impl Into<String>,
) -> Diagnostic {
    Diagnostic::at(source, offset, code, message)
}

pub(super) fn require_container(source: &str, element: &Element) -> Result<(), Diagnostic> {
    if element.self_closing {
        Err(error(
            source,
            element.offset,
            "invalid_structure",
            format!("<{}> needs a closing tag.", element.name),
        ))
    } else {
        Ok(())
    }
}

pub(super) fn allowed_attributes(
    source: &str,
    element: &Element,
    allowed: &[&str],
) -> Result<(), Diagnostic> {
    if let Some(attribute) = element
        .attributes
        .iter()
        .find(|attribute| !allowed.contains(&attribute.name.as_str()))
    {
        return Err(error(
            source,
            attribute.offset,
            "invalid_attribute",
            format!(
                "Attribute '{}' is not allowed on <{}>.",
                attribute.name, element.name
            ),
        ));
    }
    Ok(())
}

pub(super) fn children<'a>(
    source: &str,
    element: &'a Element,
) -> Result<Vec<&'a Element>, Diagnostic> {
    let mut result = Vec::new();
    for content in &element.content {
        match content {
            Content::Text(text, offset) if !text.trim().is_empty() => {
                return Err(error(
                    source,
                    *offset,
                    "unexpected_text",
                    "Text must be inside a component child tag.",
                ));
            }
            Content::Element(child) => result.push(child),
            Content::Text(..) => {}
        }
    }
    Ok(result)
}

pub(super) fn text(
    source: &str,
    element: &Element,
    allowed: &[&str],
) -> Result<String, Diagnostic> {
    require_container(source, element)?;
    allowed_attributes(source, element, allowed)?;
    let mut value = String::new();
    for content in &element.content {
        match content {
            Content::Text(part, _) => value.push_str(part),
            Content::Element(child) => {
                return Err(error(
                    source,
                    child.offset,
                    "nested_element",
                    "A text label cannot contain another tag.",
                ))
            }
        }
    }
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(error(
            source,
            element.offset,
            "empty_text",
            format!("<{}> needs text.", element.name),
        ));
    }
    Ok(value)
}

pub(super) fn identifier(source: &str, attribute: &Attribute) -> Result<String, Diagnostic> {
    let value = attribute.value.as_str();
    let mut bytes = value.bytes();
    let valid = value.len() <= 64
        && bytes
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && !["constructor", "prototype", "__proto__"].contains(&value);
    if !valid {
        return Err(error(
            source,
            attribute.offset,
            "invalid_identifier",
            format!(
                "{} must start with a letter and use at most 64 letters, numbers, _ or -.",
                attribute.name
            ),
        ));
    }
    Ok(value.to_owned())
}

pub(super) fn required_attribute<'a>(
    source: &str,
    element: &'a Element,
    name: &str,
) -> Result<&'a Attribute, Diagnostic> {
    element
        .attributes
        .iter()
        .find(|attribute| attribute.name == name)
        .ok_or_else(|| {
            error(
                source,
                element.offset,
                "missing_attribute",
                format!("<{}> needs {}=\"...\".", element.name, name),
            )
        })
}

pub(super) fn unique(
    source: &str,
    element: &Element,
    seen: &mut HashSet<String>,
    value: String,
) -> Result<String, Diagnostic> {
    if !seen.insert(value.clone()) {
        return Err(error(
            source,
            element.offset,
            "duplicate_id",
            format!("'{value}' is used more than once."),
        ));
    }
    Ok(value)
}
