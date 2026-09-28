use crate::Diagnostic;

pub(super) struct Cursor<'a> {
    source: &'a str,
    pub(super) offset: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(source: &'a str) -> Self {
        Self { source, offset: 0 }
    }

    pub(super) fn whitespace(&mut self) {
        while self
            .source
            .as_bytes()
            .get(self.offset)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.offset += 1;
        }
    }

    pub(super) fn error(&self, code: &'static str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::at(self.source, self.offset, code, message)
    }

    pub(super) fn word(&mut self) -> Option<String> {
        self.whitespace();
        let bytes = self.source.as_bytes();
        let start = self.offset;
        if !bytes.get(start).is_some_and(u8::is_ascii_alphabetic) {
            return None;
        }
        self.offset += 1;
        while bytes
            .get(self.offset)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
        {
            self.offset += 1;
        }
        Some(self.source[start..self.offset].to_owned())
    }

    pub(super) fn expect_word(&mut self, word: &str) -> Result<(), Diagnostic> {
        if self.word().as_deref() == Some(word) {
            Ok(())
        } else {
            Err(self.error("logic_syntax", format!("Expected '{word}'.")))
        }
    }

    fn take(&mut self, mark: char) -> bool {
        self.whitespace();
        if self.source[self.offset..].starts_with(mark) {
            self.offset += mark.len_utf8();
            true
        } else {
            false
        }
    }

    pub(super) fn expect(&mut self, mark: char) -> Result<(), Diagnostic> {
        if self.take(mark) {
            Ok(())
        } else {
            Err(self.error("logic_syntax", format!("Expected '{mark}'.")))
        }
    }

    pub(super) fn quoted(&mut self) -> Result<String, Diagnostic> {
        self.whitespace();
        let start = self.offset;
        if !self.source[start..].starts_with('"') {
            return Err(self.error("logic_argument", "Use a quoted string."));
        }
        self.offset += 1;
        let mut escaped = false;
        while let Some(byte) = self.source.as_bytes().get(self.offset) {
            if !escaped && *byte == b'"' {
                self.offset += 1;
                return serde_json::from_str(&self.source[start..self.offset])
                    .map_err(|_| self.error("logic_argument", "Invalid quoted string."));
            }
            escaped = !escaped && *byte == b'\\';
            if *byte != b'\\' {
                escaped = false;
            }
            self.offset += 1;
        }
        Err(self.error("logic_argument", "Unclosed quoted string."))
    }

    pub(super) fn number(&mut self) -> Result<f64, Diagnostic> {
        self.whitespace();
        let start = self.offset;
        while self
            .source
            .as_bytes()
            .get(self.offset)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'.')
        {
            self.offset += 1;
        }
        let parsed = self.source[start..self.offset].parse::<f64>();
        match parsed {
            Ok(value) if value.is_finite() && value >= 0.0 => Ok(value),
            _ => Err(self.error(
                "logic_argument",
                "Use a non-negative finite number of seconds.",
            )),
        }
    }

    pub(super) fn json_object(&mut self) -> Result<&'a str, Diagnostic> {
        self.whitespace();
        let start = self.offset;
        if !self.source[start..].starts_with('{') {
            return Err(self.error("logic_argument", "request() needs a JSON object."));
        }
        let mut depth = 0usize;
        let mut quoted = false;
        let mut escaped = false;
        for (index, byte) in self.source.as_bytes()[start..].iter().enumerate() {
            if quoted {
                if escaped {
                    escaped = false;
                } else if *byte == b'\\' {
                    escaped = true;
                } else if *byte == b'"' {
                    quoted = false;
                }
                continue;
            }
            match byte {
                b'"' => quoted = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        self.offset = start + index + 1;
                        return Ok(&self.source[start..self.offset]);
                    }
                }
                _ => {}
            }
        }
        Err(self.error("logic_argument", "Unclosed request JSON object."))
    }
}
