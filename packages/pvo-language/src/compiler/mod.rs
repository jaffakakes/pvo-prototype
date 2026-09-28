use serde::Serialize;

use crate::{compile_style, parse_logic, parse_structure, Component, Diagnostic, Rule};

mod metadata;
mod render;

use metadata::{kind_of, selectors};
use render::{default_css, render_html};

#[derive(Debug, Clone, Serialize)]
pub struct CompileError {
    pub part: &'static str,
    pub diagnostic: Diagnostic,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledComponent {
    pub structure: Component,
    pub rules: Vec<Rule>,
    pub html: String,
    pub css: String,
    pub js: String,
}

/// Compiles the small, typed PVO language to the existing isolated component
/// renderer format. The source is checked again by the player before use.
pub fn compile_component(
    kind: &str,
    structure: &str,
    style: &str,
    logic: &str,
) -> Result<CompiledComponent, CompileError> {
    let component = parse_structure(structure).map_err(|diagnostic| CompileError {
        part: "structure",
        diagnostic,
    })?;
    let actual_kind = kind_of(&component);
    if kind != actual_kind {
        return Err(CompileError {
            part: "structure",
            diagnostic: Diagnostic::at(
                structure,
                0,
                "kind_mismatch",
                format!("This component is a {kind}; use <{kind}> as its Structure root."),
            ),
        });
    }

    let rules = parse_logic(logic, &component).map_err(|diagnostic| CompileError {
        part: "logic",
        diagnostic,
    })?;
    let (tags, ids) = selectors(&component);
    let custom_css = compile_style(style, &tags, &ids).map_err(|error| CompileError {
        part: "style",
        diagnostic: Diagnostic::at(style, error.offset, "invalid_style", error.message),
    })?;
    let mut css = default_css().to_owned();
    css.push_str(&custom_css);

    Ok(CompiledComponent {
        html: render_html(&component),
        css,
        js: String::new(),
        structure: component,
        rules,
    })
}
