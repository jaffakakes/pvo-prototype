use serde::Serialize;

/// Logic describes the outcome; the renderer reports only which control fired.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Action {
    Continue,
    Time {
        t: f64,
    },
    Scene {
        #[serde(rename = "sceneId")]
        scene_id: String,
    },
    Request {
        url: String,
        method: String,
        body: String,
        #[serde(rename = "onSuccess")]
        on_success: PlaybackRoute,
        #[serde(rename = "onError")]
        on_error: Option<PlaybackRoute>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PlaybackRoute {
    Continue,
    Time {
        t: f64,
    },
    Scene {
        #[serde(rename = "sceneId")]
        scene_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Rule {
    pub event: String,
    pub target: Option<String>,
    pub action: Action,
}
