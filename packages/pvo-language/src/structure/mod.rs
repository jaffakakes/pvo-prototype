mod checks;
mod model;
mod parser;
mod validation;

pub use model::{Button, Component, Field, FieldKind, OptionItem};

use crate::Diagnostic;

/// Parse PVO Structure 0.1. The returned AST is data, not executable code.
pub fn parse_structure(source: &str) -> Result<Component, Diagnostic> {
    let root = parser::parse_document(source)?;
    validation::validate(source, &root)
}
