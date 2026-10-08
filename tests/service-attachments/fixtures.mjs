export function attachment(releaseId) {
  return {
    kind: "service.attach",
    component: {
      kind: "component.add",
      sceneId: "main",
      componentType: "form",
      at: 0,
      duration: 3,
      source: {
        structure: 'form { name guest "Name"; submit "Join"; }',
        style: "",
        logic: "on submit -> continue;",
      },
    },
    connection: {
      releaseId,
      operation: "join",
      event: "submit",
      target: null,
      input: {
        kind: "object",
        fields: [{ name: "name", value: { kind: "field", name: "guest" } }],
      },
    },
  };
}
