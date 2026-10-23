pub(super) fn is_allowed_property(property: &str) -> bool {
    matches!(
        property,
        "color"
            | "background"
            | "background-color"
            | "border-color"
            | "border-radius"
            | "border-width"
            | "box-shadow"
            | "font-size"
            | "font-weight"
            | "gap"
            | "letter-spacing"
            | "line-height"
            | "padding"
            | "text-align"
            | "text-transform"
    )
}

pub(super) fn valid_value(property: &str, value: &str) -> bool {
    match property {
        "color" | "background" | "background-color" | "border-color" => valid_color(value),
        "border-radius" => value == "0" || valid_px(value, 0.0, 64.0),
        "border-width" => value == "0" || valid_px(value, 0.0, 8.0),
        "box-shadow" => valid_shadow(value),
        "font-size" => valid_px(value, 8.0, 72.0),
        "font-weight" => matches!(value, "400" | "500" | "600" | "700" | "800" | "900"),
        "gap" => value == "0" || valid_px(value, 0.0, 32.0),
        "letter-spacing" => value == "0" || valid_px(value, 0.0, 8.0),
        "line-height" => valid_unitless(value, 1.0, 2.5),
        "padding" => value == "0" || valid_px(value, 0.0, 40.0),
        "text-align" => matches!(value, "left" | "center" | "right"),
        "text-transform" => matches!(value, "none" | "uppercase" | "lowercase"),
        _ => false,
    }
}

fn valid_shadow(value: &str) -> bool {
    if value == "none" {
        return true;
    }
    let parts: Vec<_> = value.split_whitespace().collect();
    parts.len() >= 4
        && valid_px(parts[0], 0.0, 16.0)
        && valid_px(parts[1], 0.0, 16.0)
        && valid_px(parts[2], 0.0, 24.0)
        && valid_color(&parts[3..].join(" "))
}

fn valid_unitless(value: &str, min: f64, max: f64) -> bool {
    !value.is_empty()
        && value.len() <= 8
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        && value
            .parse::<f64>()
            .is_ok_and(|parsed| parsed.is_finite() && (min..=max).contains(&parsed))
}

fn valid_color(value: &str) -> bool {
    if matches!(value, "transparent" | "currentColor") {
        return true;
    }
    if let Some(hex) = value.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8)
            && hex.bytes().all(|byte| byte.is_ascii_hexdigit());
    }
    if let Some(args) = value
        .strip_prefix("rgb(")
        .and_then(|value| value.strip_suffix(')'))
    {
        return valid_rgb(args, false);
    }
    if let Some(args) = value
        .strip_prefix("rgba(")
        .and_then(|value| value.strip_suffix(')'))
    {
        return valid_rgb(args, true);
    }
    false
}

fn valid_rgb(args: &str, with_alpha: bool) -> bool {
    let parts: Vec<_> = args.split(',').map(str::trim).collect();
    if parts.len() != if with_alpha { 4 } else { 3 } {
        return false;
    }
    if !parts[..3].iter().all(|part| {
        !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && part.parse::<u16>().is_ok_and(|number| number <= 255)
    }) {
        return false;
    }
    if with_alpha {
        let alpha = parts[3];
        !alpha.is_empty()
            && alpha.len() <= 6
            && alpha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
            && alpha
                .parse::<f32>()
                .is_ok_and(|number| number.is_finite() && (0.0..=1.0).contains(&number))
    } else {
        true
    }
}

fn valid_px(value: &str, min: f64, max: f64) -> bool {
    let Some(number) = value.strip_suffix("px") else {
        return false;
    };
    !number.is_empty()
        && number.len() <= 8
        && number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        && number
            .parse::<f64>()
            .is_ok_and(|parsed| parsed.is_finite() && (min..=max).contains(&parsed))
}
