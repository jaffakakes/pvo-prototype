use crate::Diagnostic;

pub(crate) const MAX_SOURCE_BYTES: usize = 20_000;
const MAX_ELEMENTS: usize = 64;
const MAX_DEPTH: usize = 2;

#[derive(Debug)]
pub(crate) struct Element {
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub content: Vec<Content>,
    pub self_closing: bool,
    pub offset: usize,
}

#[derive(Debug)]
pub(crate) struct Attribute {
    pub name: String,
    pub value: String,
    pub offset: usize,
}

#[derive(Debug)]
pub(crate) enum Content {
    Text(String, usize),
    Element(Element),
}

pub(crate) fn parse_document(source: &str) -> Result<Element, Diagnostic> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(Diagnostic::at(
            source,
            0,
            "source_too_large",
            format!("A component must be at most {MAX_SOURCE_BYTES} bytes."),
        ));
    }
    let mut parser = Parser {
        source,
        offset: 0,
        elements: 0,
    };
    parser.skip_space();
    let root = parser.parse_element(1)?;
    parser.skip_space();
    if !parser.at_end() {
        return Err(parser.error("extra_content", "Only one component root is allowed."));
    }
    Ok(root)
}

struct Parser<'a> {
    source: &'a str,
    offset: usize,
    elements: usize,
}

impl Parser<'_> {
    fn rest(&self) -> &str {
        &self.source[self.offset..]
    }
    fn at_end(&self) -> bool {
        self.offset == self.source.len()
    }
    fn starts(&self, text: &str) -> bool {
        self.rest().starts_with(text)
    }
    fn error(&self, code: &'static str, message: impl Into<String>) -> Diagnostic {
        Diagnostic::at(self.source, self.offset, code, message)
    }
    fn advance(&mut self, bytes: usize) {
        self.offset += bytes;
    }
    fn skip_space(&mut self) {
        while let Some(ch) = self.rest().chars().next() {
            if !ch.is_whitespace() {
                break;
            }
            self.advance(ch.len_utf8());
        }
    }

    fn expect(&mut self, text: &str) -> Result<(), Diagnostic> {
        if !self.starts(text) {
            return Err(self.error("syntax", format!("Expected {text}.")));
        }
        self.advance(text.len());
        Ok(())
    }

    fn name(&mut self) -> Result<String, Diagnostic> {
        let first = self.rest().bytes().next();
        if !first.is_some_and(|byte| byte.is_ascii_alphabetic()) {
            return Err(self.error("syntax", "Expected a tag or attribute name."));
        }
        let start = self.offset;
        while let Some(byte) = self.rest().bytes().next() {
            if !byte.is_ascii_alphanumeric() && byte != b'-' && byte != b'_' {
                break;
            }
            self.advance(1);
        }
        Ok(self.source[start..self.offset].to_owned())
    }

    fn attribute(&mut self) -> Result<Attribute, Diagnostic> {
        let offset = self.offset;
        let name = self.name()?;
        self.skip_space();
        self.expect("=")?;
        self.skip_space();
        let quote = self
            .rest()
            .chars()
            .next()
            .ok_or_else(|| self.error("syntax", "Expected a quoted attribute value."))?;
        if quote != '\'' && quote != '"' {
            return Err(self.error("syntax", "Attribute values must be quoted."));
        }
        self.advance(1);
        let value_start = self.offset;
        let end = self
            .rest()
            .find(quote)
            .ok_or_else(|| self.error("syntax", "Unclosed attribute value."))?;
        let raw = &self.rest()[..end];
        if raw.contains('<') {
            return Err(Diagnostic::at(
                self.source,
                value_start,
                "syntax",
                "A tag cannot appear inside an attribute.",
            ));
        }
        let value = decode_entities(self.source, raw, value_start)?;
        self.advance(end + 1);
        Ok(Attribute {
            name,
            value,
            offset,
        })
    }

    fn parse_element(&mut self, depth: usize) -> Result<Element, Diagnostic> {
        if depth > MAX_DEPTH {
            return Err(self.error(
                "nested_element",
                "Components allow only a root and direct children.",
            ));
        }
        let offset = self.offset;
        self.expect("<")?;
        if self.starts("/") || self.starts("!") || self.starts("?") {
            return Err(self.error("syntax", "Expected an opening component tag."));
        }
        self.elements += 1;
        if self.elements > MAX_ELEMENTS {
            return Err(self.error("too_many_elements", "This component has too many elements."));
        }
        let name = self.name()?;
        let mut attributes = Vec::new();
        loop {
            self.skip_space();
            if self.starts("/>") {
                self.advance(2);
                return Ok(Element {
                    name,
                    attributes,
                    content: Vec::new(),
                    self_closing: true,
                    offset,
                });
            }
            if self.starts(">") {
                self.advance(1);
                break;
            }
            if self.at_end() {
                return Err(self.error("syntax", "Unclosed opening tag."));
            }
            let attribute = self.attribute()?;
            if attributes
                .iter()
                .any(|existing: &Attribute| existing.name == attribute.name)
            {
                return Err(Diagnostic::at(
                    self.source,
                    attribute.offset,
                    "duplicate_attribute",
                    format!("Attribute '{}' is repeated.", attribute.name),
                ));
            }
            attributes.push(attribute);
        }

        let mut content = Vec::new();
        loop {
            if self.at_end() {
                return Err(Diagnostic::at(
                    self.source,
                    offset,
                    "syntax",
                    format!("Unclosed <{name}> tag."),
                ));
            }
            if self.starts("</") {
                self.advance(2);
                let closing = self.name()?;
                self.skip_space();
                self.expect(">")?;
                if closing != name {
                    return Err(Diagnostic::at(
                        self.source,
                        offset,
                        "syntax",
                        format!("Expected </{name}>, found </{closing}>."),
                    ));
                }
                break;
            }
            if self.starts("<") {
                content.push(Content::Element(self.parse_element(depth + 1)?));
            } else {
                let text_offset = self.offset;
                let end = self.rest().find('<').unwrap_or(self.rest().len());
                let raw = &self.rest()[..end];
                let text = decode_entities(self.source, raw, text_offset)?;
                self.advance(end);
                content.push(Content::Text(text, text_offset));
            }
        }
        Ok(Element {
            name,
            attributes,
            content,
            self_closing: false,
            offset,
        })
    }
}

fn decode_entities(source: &str, raw: &str, offset: usize) -> Result<String, Diagnostic> {
    let mut decoded = String::with_capacity(raw.len());
    let mut start = 0;
    while let Some(relative) = raw[start..].find('&') {
        let amp = start + relative;
        decoded.push_str(&raw[start..amp]);
        let after_amp = amp + 1;
        let semi = raw[after_amp..]
            .find(';')
            .map(|index| after_amp + index)
            .ok_or_else(|| {
                Diagnostic::at(source, offset + amp, "syntax", "Unclosed text entity.")
            })?;
        let replacement = match &raw[after_amp..semi] {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            "#39" | "#x27" | "#X27" => '\'',
            _ => {
                return Err(Diagnostic::at(
                    source,
                    offset + amp,
                    "syntax",
                    "Unsupported text entity.",
                ))
            }
        };
        decoded.push(replacement);
        start = semi + 1;
    }
    decoded.push_str(&raw[start..]);
    Ok(decoded)
}
