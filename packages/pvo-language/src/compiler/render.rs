use crate::{Component, FieldKind};

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn render_html(component: &Component) -> String {
    match component {
        Component::Tooltip { text } => format!(
            "<div class=\"pvo-tooltip\"><span class=\"pvo-text\">{}</span></div>",
            escape_html(text),
        ),
        Component::Card {
            title,
            body,
            buttons,
        } => {
            let mut html = String::from("<div class=\"pvo-card\">");
            if let Some(title) = title {
                html.push_str(&format!(
                    "<h3 class=\"pvo-title\">{}</h3>",
                    escape_html(title)
                ));
            }
            if let Some(body) = body {
                html.push_str(&format!("<p class=\"pvo-body\">{}</p>", escape_html(body)));
            }
            if !buttons.is_empty() {
                html.push_str("<div class=\"pvo-actions\">");
            }
            for (index, button) in buttons.iter().enumerate() {
                // The sandbox reports the pressed control; the host executes its checked Rule.
                let handler = format!("pvo.pick({index})");
                html.push_str(&format!(
                    "<button type=\"button\" class=\"pvo-button\" data-pvo-id=\"{}\" onclick=\"{}\">{}</button>",
                    escape_html(&button.id), escape_html(&handler), escape_html(&button.label),
                ));
            }
            if !buttons.is_empty() {
                html.push_str("</div>");
            }
            html.push_str("</div>");
            html
        }
        Component::Choice { prompt, options } => {
            let mut html = format!(
                "<div class=\"pvo-choice\"><h3 class=\"pvo-prompt\">{}</h3>",
                escape_html(prompt),
            );
            for (index, option) in options.iter().enumerate() {
                let handler = format!("pvo.pick({index})");
                html.push_str(&format!(
                    "<button type=\"button\" class=\"pvo-option\" data-pvo-id=\"{}\" onclick=\"{}\">{}</button>",
                    escape_html(&option.id), escape_html(&handler), escape_html(&option.label),
                ));
            }
            html.push_str("</div>");
            html
        }
        Component::Form {
            heading,
            fields,
            submit,
            waiting,
        } => {
            let handler = "pvo.submit(fields)";
            let mut html = format!(
                "<form class=\"pvo-form\" onsubmit=\"{}\">",
                escape_html(&handler)
            );
            if let Some(heading) = heading {
                html.push_str(&format!(
                    "<h3 class=\"pvo-heading\">{}</h3>",
                    escape_html(heading)
                ));
            }
            for field in fields {
                let name = escape_html(&field.name);
                let (input_type, placeholder) = match field.kind {
                    FieldKind::Name => ("text", "Name"),
                    FieldKind::Email => ("email", "Email"),
                    FieldKind::Phone => ("tel", "Phone"),
                    FieldKind::Short => ("text", "Short text"),
                    FieldKind::Number => ("number", "Number"),
                    FieldKind::Yesno => ("checkbox", "Yes / No"),
                };
                let placeholder = escape_html(field.label.as_deref().unwrap_or(placeholder));
                if matches!(field.kind, FieldKind::Yesno) {
                    html.push_str(&format!(
                        "<label class=\"pvo-field\" data-pvo-id=\"{name}\"><input type=\"checkbox\" name=\"{name}\">{placeholder}</label>"
                    ));
                } else {
                    let step = if matches!(field.kind, FieldKind::Number) {
                        " step=\"any\""
                    } else {
                        ""
                    };
                    let label = if field.label.is_some() {
                        format!(" aria-label=\"{placeholder}\"")
                    } else {
                        String::new()
                    };
                    html.push_str(&format!(
                        "<input class=\"pvo-field\" data-pvo-id=\"{name}\" name=\"{name}\" type=\"{input_type}\" placeholder=\"{placeholder}\"{label}{step}>"
                    ));
                }
            }
            let waiting = waiting
                .as_ref()
                .map(|label| format!(" data-pvo-waiting=\"{}\"", escape_html(label)))
                .unwrap_or_default();
            html.push_str(&format!(
                "<button type=\"submit\" class=\"pvo-submit\"{waiting}>{}</button></form>",
                escape_html(submit),
            ));
            html
        }
    }
}

pub(super) fn default_css() -> &'static str {
    "#pvo-root *{box-sizing:border-box;}\n\
     #pvo-root .pvo-tooltip,#pvo-root .pvo-card,#pvo-root .pvo-choice,#pvo-root .pvo-form{\
       color:#F2F0E9;font-family:'Open Sauce Sans',system-ui,sans-serif;\
       background:#15151C;border:3px solid #000;border-radius:14px;\
       box-shadow:3px 3px 0 #000;padding:12px;}\n\
     #pvo-root .pvo-tooltip{width:max-content;max-width:220px;background:#FFD23E;color:#111;font-weight:800;font-size:13px;}\n\
     #pvo-root .pvo-card,#pvo-root .pvo-choice,#pvo-root .pvo-form{width:208px;}\n\
     #pvo-root .pvo-choice{display:grid;gap:7px;width:176px;background:transparent;border-width:0;box-shadow:none;padding:0;}\n\
     #pvo-root .pvo-title,#pvo-root .pvo-prompt,#pvo-root .pvo-heading{margin:0 0 8px;font-weight:800;font-size:19px;}\n\
     #pvo-root .pvo-prompt{margin:0;text-align:center;}\n\
     #pvo-root .pvo-body{margin:0 0 10px;font-weight:700;font-size:11px;}\n\
     #pvo-root .pvo-actions{display:flex;gap:6px;}\n\
     #pvo-root .pvo-button,#pvo-root .pvo-option,#pvo-root .pvo-submit{\
       min-height:36px;background:#A78BFA;color:#111;border:2px solid #000;\
       border-radius:9px;box-shadow:2px 2px 0 #000;font-weight:800;font-size:12px;cursor:pointer;}\n\
     #pvo-root .pvo-button{flex:1;min-width:0;background:#FF2D78;color:#F2F0E9;}\n\
     #pvo-root .pvo-option{display:block;width:100%;margin-top:0;}\n\
     #pvo-root .pvo-field{display:block;width:100%;min-height:32px;margin-bottom:6px;\
       padding:6px 8px;background:#1C1C24;color:#F2F0E9;border:2px solid #4A4757;border-radius:7px;}\n\
     #pvo-root .pvo-submit{width:100%;background:#FF2D78;color:#F2F0E9;}\n"
}
