use pvo_language::action_allowed;

#[test]
fn language_events_reveal_only_the_used_control() {
    assert!(action_allowed("card", "pick"));
    assert!(action_allowed("choice", "pick"));
    assert!(action_allowed("form", "submit"));
    for method in ["resume", "jumpTo", "goToScene", "request", "track"] {
        assert!(!action_allowed("card", method));
        assert!(!action_allowed("choice", method));
        assert!(!action_allowed("form", method));
    }
    assert!(!action_allowed("tooltip", "pick"));
}
