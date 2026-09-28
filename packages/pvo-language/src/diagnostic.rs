use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub code: &'static str,
    pub message: String,
    pub line: usize,
    pub column: usize,
}

impl Diagnostic {
    pub(crate) fn at(
        source: &str,
        offset: usize,
        code: &'static str,
        message: impl Into<String>,
    ) -> Self {
        let before = &source[..offset.min(source.len())];
        let line = before.bytes().filter(|byte| *byte == b'\n').count() + 1;
        let column = before.rsplit('\n').next().unwrap_or("").chars().count() + 1;
        Self {
            code,
            message: message.into(),
            line,
            column,
        }
    }
}
