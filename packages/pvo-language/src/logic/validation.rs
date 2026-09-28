use serde_json::{Map, Value};

use super::model::{Action, PlaybackRoute};
use crate::Diagnostic;

const MAX_REQUEST_BYTES: usize = 12_000;
const MAX_URL_BYTES: usize = 2_048;
const MAX_BODY_BYTES: usize = 8_192;
const MAX_SCENE_ID_BYTES: usize = 128;

pub(super) fn valid_scene_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SCENE_ID_BYTES
        && value.trim() == value
        && !value
            .chars()
            .any(|ch| ch.is_control() || ch == '{' || ch == '}')
}

fn valid_http_url(value: &str) -> bool {
    if value.len() > MAX_URL_BYTES
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control() || ch == '\\')
    {
        return false;
    }
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    let Some(rest) = rest else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains(['@', '{', '}']) {
        return false;
    }
    let (host, port) = if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return false;
        };
        let host = &authority[1..end];
        if host.is_empty()
            || !host.contains(':')
            || !host
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b':')
        {
            return false;
        }
        let suffix = &authority[end + 1..];
        if suffix.is_empty() {
            (host, None)
        } else if let Some(port) = suffix.strip_prefix(':') {
            (host, Some(port))
        } else {
            return false;
        }
    } else {
        let (host, port) = authority
            .rsplit_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        if host.is_empty()
            || !host.split('.').all(|label| {
                !label.is_empty()
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
        {
            return false;
        }
        (host, port)
    };
    if host.is_empty() {
        return false;
    }
    port.is_none_or(|port| {
        !port.is_empty()
            && port.bytes().all(|byte| byte.is_ascii_digit())
            && port.parse::<u16>().is_ok_and(|number| number > 0)
    })
}

fn exactly_keys(object: &Map<String, Value>, names: &[&str]) -> bool {
    object.len() == names.len() && names.iter().all(|name| object.contains_key(*name))
}

fn playback_route(value: &Value) -> Result<PlaybackRoute, &'static str> {
    let object = value.as_object().ok_or("A route must be a JSON object.")?;
    match object.get("kind").and_then(Value::as_str) {
        Some("continue") if exactly_keys(object, &["kind"]) => Ok(PlaybackRoute::Continue),
        Some("time") if exactly_keys(object, &["kind", "t"]) => {
            let time = object["t"]
                .as_f64()
                .ok_or("A time route needs numeric t.")?;
            if !time.is_finite() || time < 0.0 {
                return Err("A time route needs non-negative finite t.");
            }
            Ok(PlaybackRoute::Time { t: time })
        }
        Some("scene") if exactly_keys(object, &["kind", "sceneId"]) => {
            let id = object["sceneId"]
                .as_str()
                .ok_or("A scene route needs sceneId.")?;
            if !valid_scene_id(id) {
                return Err("A scene route needs a valid sceneId of at most 128 bytes.");
            }
            Ok(PlaybackRoute::Scene {
                scene_id: id.to_owned(),
            })
        }
        _ => Err("Route must be continue, time, or scene with only its required fields."),
    }
}

pub(super) fn request_action(source: &str, offset: usize, raw: &str) -> Result<Action, Diagnostic> {
    let invalid = |message: &str| Diagnostic::at(source, offset, "invalid_request", message);
    if raw.len() > MAX_REQUEST_BYTES {
        return Err(invalid(&format!(
            "Request JSON must be at most {MAX_REQUEST_BYTES} bytes."
        )));
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|_| invalid("Request must be valid JSON."))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Request must be a JSON object."))?;
    if !exactly_keys(object, &["url", "method", "body", "onSuccess", "onError"]) {
        return Err(invalid(
            "Request needs only url, method, body, onSuccess, and onError.",
        ));
    }
    let url = object["url"]
        .as_str()
        .ok_or_else(|| invalid("Request url must be a string."))?;
    if !valid_http_url(url) {
        return Err(invalid(
            "Request URL must be an absolute HTTP(S) URL with a fixed host.",
        ));
    }
    let method = object["method"]
        .as_str()
        .ok_or_else(|| invalid("Request method must be GET or POST."))?;
    if method != "GET" && method != "POST" {
        return Err(invalid("Request method must be GET or POST."));
    }
    let body = object["body"]
        .as_str()
        .ok_or_else(|| invalid("Request body must be a JSON string or empty."))?;
    if body.len() > MAX_BODY_BYTES {
        return Err(invalid(&format!(
            "Request body must be at most {MAX_BODY_BYTES} bytes."
        )));
    }
    if !body.is_empty() && serde_json::from_str::<Value>(body).is_err() {
        return Err(invalid("Request body must be valid JSON or empty."));
    }
    let on_success = playback_route(&object["onSuccess"]).map_err(invalid)?;
    let on_error = if object["onError"].is_null() {
        None
    } else {
        Some(playback_route(&object["onError"]).map_err(invalid)?)
    };
    Ok(Action::Request {
        url: url.to_owned(),
        method: method.to_owned(),
        body: body.to_owned(),
        on_success,
        on_error,
    })
}
