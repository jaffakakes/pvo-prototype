use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleError {
    pub offset: usize,
    pub message: String,
}

impl fmt::Display for StyleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for StyleError {}
