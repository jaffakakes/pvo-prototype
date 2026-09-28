use crate::Component;

pub(super) fn kind_of(component: &Component) -> &'static str {
    match component {
        Component::Tooltip { .. } => "tooltip",
        Component::Card { .. } => "card",
        Component::Choice { .. } => "choice",
        Component::Form { .. } => "form",
    }
}

pub(super) fn selectors(component: &Component) -> (Vec<&'static str>, Vec<String>) {
    match component {
        Component::Tooltip { .. } => (vec!["tooltip", "text"], Vec::new()),
        Component::Card { buttons, .. } => (
            vec!["card", "title", "body", "button"],
            buttons.iter().map(|button| button.id.clone()).collect(),
        ),
        Component::Choice { options, .. } => (
            vec!["choice", "prompt", "option"],
            options.iter().map(|option| option.id.clone()).collect(),
        ),
        Component::Form { fields, .. } => (
            vec!["form", "heading", "field", "submit"],
            fields.iter().map(|field| field.name.clone()).collect(),
        ),
    }
}
