use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Component {
    Tooltip {
        text: String,
    },
    Card {
        title: Option<String>,
        body: Option<String>,
        buttons: Vec<Button>,
    },
    Choice {
        prompt: String,
        options: Vec<OptionItem>,
    },
    Form {
        #[serde(skip_serializing_if = "Option::is_none")]
        heading: Option<String>,
        fields: Vec<Field>,
        submit: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        waiting: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Button {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OptionItem {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Field {
    pub name: String,
    pub kind: FieldKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldKind {
    Name,
    Email,
    Phone,
    Short,
    Number,
    Yesno,
}
