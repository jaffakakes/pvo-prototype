export function manifest() {
  return {
    spec_version: "0.1-prototype",
    id: "sdk_test",
    title: "SDK test",
    initial_scene: "intro",
    allowed_domains: ["creator.example"],
    state: { initial: { score: 1, path: "left" } },
    scenes: [
      { id: "intro", start: 0, end: 5, next: "ending" },
      { id: "ending", start: 5, end: 10 },
    ],
    components: [
      { id: "tip", kind: "tooltip", text: "Score: {state.score}" },
      {
        id: "choice",
        kind: "choice",
        presentation: {
          scene: "intro",
          start: 1,
          end: 4,
          x: 0.2,
          y: 0.2,
          width: 0.5,
          height: 0.3,
        },
        response_policy: { dispatch: "interaction", unanswered: "continue" },
        options: [
          { label: "End", actions: [{ type: "goto_scene", scene: "ending" }] },
          { label: "Stay", actions: [{ type: "seek", time: 0 }] },
        ],
      },
      {
        id: "form",
        kind: "form",
        presentation: {
          scene: "intro",
          start: 1,
          end: 4,
          x: 0.2,
          y: 0.2,
          width: 0.5,
          height: 0.3,
        },
        response_policy: { dispatch: "interaction", unanswered: "continue" },
        fields: [],
        on_submit: [{ type: "request", url: "https://creator.example/submit" }],
      },
    ],
    hotspots: [
      {
        id: "target",
        scene: "intro",
        start: 0,
        end: 5,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.25,
        actions: [{ type: "show", component: "tip" }],
      },
    ],
    triggers: [],
  };
}
