use super::StyleError;

pub(super) struct StyleParser<'a> {
    pub(super) source: &'a str,
    pub(super) offset: usize,
}

impl<'a> StyleParser<'a> {
    fn rest(&self) -> &'a str {
        &self.source[self.offset..]
    }

    pub(super) fn at_end(&self) -> bool {
        self.offset == self.source.len()
    }

    pub(super) fn error(&self, message: impl Into<String>) -> StyleError {
        StyleError {
            offset: self.offset,
            message: message.into(),
        }
    }

    pub(super) fn skip_space(&mut self) {
        while let Some(character) = self.rest().chars().next() {
            if !character.is_whitespace() {
                break;
            }
            self.offset += character.len_utf8();
        }
    }

    pub(super) fn take(&mut self, expected: u8) -> bool {
        if self.rest().as_bytes().first() == Some(&expected) {
            self.offset += 1;
            true
        } else {
            false
        }
    }

    pub(super) fn expect(&mut self, expected: u8, message: &str) -> Result<(), StyleError> {
        if self.take(expected) {
            Ok(())
        } else {
            Err(self.error(message))
        }
    }

    pub(super) fn identifier(&mut self, allow_initial_digit: bool) -> Result<&'a str, StyleError> {
        let start = self.offset;
        let Some(first) = self.rest().as_bytes().first().copied() else {
            return Err(self.error("Expected an identifier."));
        };
        if !first.is_ascii_alphabetic()
            && first != b'_'
            && first != b'-'
            && !(allow_initial_digit && first.is_ascii_digit())
        {
            return Err(self.error("Expected a simple local identifier."));
        }
        while let Some(byte) = self.rest().as_bytes().first().copied() {
            if !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-' {
                break;
            }
            self.offset += 1;
        }
        Ok(&self.source[start..self.offset])
    }

    pub(super) fn selector(
        &mut self,
        allowed_tags: &[&str],
        ids: &[String],
    ) -> Result<String, StyleError> {
        let start = self.offset;
        if self.take(b'#') {
            let id = self.identifier(true)?;
            if !ids.iter().any(|known| known == id) {
                return Err(StyleError {
                    offset: start,
                    message: format!("Unknown local ID '#{id}'."),
                });
            }
            return Ok(format!("[data-pvo-id=\"{id}\"]"));
        }

        let tag = self.identifier(false)?;
        if !allowed_tags.contains(&tag) {
            return Err(StyleError {
                offset: start,
                message: format!("'{tag}' is not an element in this component."),
            });
        }
        Ok(format!(".pvo-{tag}"))
    }

    pub(super) fn value(&mut self) -> Result<&'a str, StyleError> {
        let start = self.offset;
        while let Some(character) = self.rest().chars().next() {
            if character == ';' {
                let value = self.source[start..self.offset].trim();
                self.offset += 1;
                if value.is_empty() {
                    return Err(StyleError {
                        offset: start,
                        message: "A property needs a value.".into(),
                    });
                }
                return Ok(value);
            }
            if character == '}' {
                return Err(self.error("Expected ';' after the property value."));
            }
            if matches!(character, '{' | '"' | '\'' | '@' | '/' | '\\') {
                return Err(self.error(
                    "Strings, comments, at-rules, and resource URLs are not allowed in PVO Style.",
                ));
            }
            self.offset += character.len_utf8();
        }
        Err(self.error("Expected ';' after the property value."))
    }
}
