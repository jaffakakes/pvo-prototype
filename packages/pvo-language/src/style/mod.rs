mod error;
mod parser;
mod values;

pub use error::StyleError;

use parser::StyleParser;
use values::{is_allowed_property, valid_value};

const MAX_STYLE_BYTES: usize = 20_000;
const MAX_RULES: usize = 64;
const MAX_DECLARATIONS: usize = 256;

/// Compile the visual-only PVO Style subset into CSS scoped to one component.
///
/// `allowed_tags` and `ids` come from the validated Structure tree. Both the
/// selector grammar and each property's value grammar are restrictive so that
/// neither input can inject a selector, declaration, or resource load.
pub fn compile_style(
    source: &str,
    allowed_tags: &[&str],
    ids: &[String],
) -> Result<String, StyleError> {
    if source.len() > MAX_STYLE_BYTES {
        return Err(StyleError {
            offset: MAX_STYLE_BYTES,
            message: format!("Style must be at most {MAX_STYLE_BYTES} bytes."),
        });
    }

    let mut parser = StyleParser { source, offset: 0 };
    let mut css = String::new();
    let mut rules = 0;
    let mut declarations = 0;

    loop {
        parser.skip_space();
        if parser.at_end() {
            break;
        }
        if rules == MAX_RULES {
            return Err(parser.error("Too many style rules."));
        }
        rules += 1;

        let selector = parser.selector(allowed_tags, ids)?;
        parser.skip_space();
        parser.expect(b'{', "Expected '{' after the selector.")?;
        let mut body = String::new();
        let mut has_declaration = false;

        loop {
            parser.skip_space();
            if parser.take(b'}') {
                if !has_declaration {
                    return Err(parser.error("A style rule needs a visual property."));
                }
                break;
            }
            if parser.at_end() {
                return Err(parser.error("Unclosed style rule."));
            }
            if declarations == MAX_DECLARATIONS {
                return Err(parser.error("Too many style properties."));
            }

            let property_offset = parser.offset;
            let property = parser.identifier(false)?;
            if !is_allowed_property(property) {
                return Err(StyleError {
                    offset: property_offset,
                    message: format!("'{property}' is not a visual property allowed by PVO Style."),
                });
            }
            parser.skip_space();
            parser.expect(b':', "Expected ':' after the property name.")?;
            parser.skip_space();
            let value_offset = parser.offset;
            let value = parser.value()?;
            if !valid_value(property, value) {
                return Err(StyleError {
                    offset: value_offset,
                    message: format!("Unsafe or unsupported value for '{property}'."),
                });
            }

            body.push_str(property);
            body.push(':');
            body.push_str(value);
            body.push(';');
            declarations += 1;
            has_declaration = true;
        }

        css.push_str("#pvo-root ");
        css.push_str(&selector);
        css.push('{');
        css.push_str(&body);
        css.push_str("}\n");
    }

    Ok(css)
}
