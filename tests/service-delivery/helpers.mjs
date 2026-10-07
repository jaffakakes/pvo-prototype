import { buildSync } from "esbuild";
import { prepareServiceAttachmentReceipt } from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";

const bundle = buildSync({
  stdin: {
    contents: `
    export * from "./editor/src/domain/export/serviceDelivery.ts";
    export * from "./editor/src/features/export/activateExportServices.ts";
    export { buildPvoManifest } from "./editor/src/domain/export/manifest.ts";
    export * from "./editor/src/domain/publishing/exportSnapshot.ts";
    export * from "./editor/src/state/export/exportArtifactStore.ts";
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
export const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
export { now };

export async function setup() {
  const publication = await prepareServicePublication(
    create(),
    "host-one",
    await checkedFixture(),
    now + 86400000,
  );
  const identity = publication.identity;
  const origin = "https://services.example";
  const binding = {
    kind: "object",
    fields: [{ name: "name", value: { kind: "field", name: "guest" } }],
  };
  const connection = {
    origin,
    receipt: prepareServiceAttachmentReceipt(
      publication,
      { identity, state: "available" },
      "join",
      now,
    ),
    connection: {
      releaseId: identity.resourceId,
      operation: "join",
      event: "submit",
      target: null,
      input: binding,
    },
  };
  const outcome = {
    kind: "request",
    url: `${origin}/api/services/${identity.serviceId}/actions`,
    method: "POST",
    body: JSON.stringify({ operation: "join", input: binding }),
    onSuccess: { kind: "continue" },
    onError: null,
  };
  const compiled = {
    structure: {
      type: "form",
      heading: "Join",
      submit: "Join",
      fields: [{ name: "guest", kind: "name", label: "Name" }],
    },
    rules: [{ event: "submit", target: null, action: outcome }],
    html: "",
    css: "",
    js: "",
  };
  const component = {
    id: "join",
    type: "form",
    sceneId: "main",
    at: 0,
    dur: null,
    x: 50,
    y: 50,
    scale: 1,
    responsePolicy: { dispatch: "interaction", unanswered: "pause" },
    fields: { outcome, fieldKinds: ["name"] },
    serviceConnection: connection,
    code: {
      custom: true,
      pvo: { structure: "", style: "", logic: "" },
      pvoCompiled: compiled,
    },
  };
  const scope = {
    origin,
    localId: "local-one",
    ownerId: identity.ownerId,
    assistantTaskLinks: {
      localId: "local-one",
      accounts: [
        {
          ownerId: identity.ownerId,
          projectId: identity.projectId,
          taskId: identity.taskId,
        },
      ],
    },
  };
  const snapshot = api.captureExportSnapshot(
    {
      currentSceneId: "main",
      ratio: "9:16",
      coverAt: 0,
      quality: "720p",
      allowedDomains: ["services.example"],
      scenes: [
        {
          id: "main",
          name: "Main",
          parent: null,
          clips: [
            {
              id: 1,
              url: "blob:original",
              in: 0,
              out: 2,
              speed: 1,
              zoom: 1,
              mirror: false,
              color: "#000",
            },
          ],
          texts: [],
          components: [component],
          layers: ["video", "component:join"],
          muted: true,
          sound: 0,
        },
      ],
    },
    "export-one",
  );
  snapshot.services = api.prepareExportServices(snapshot, scope);
  const summary = {
    service: {
      identity: {
        serviceId: identity.serviceId,
        ownerId: identity.ownerId,
        projectId: identity.projectId,
      },
      state: "inactive",
      revision: 1,
      testReleaseId: identity.resourceId,
      liveReleaseId: null,
      createdAt: now,
      updatedAt: now,
    },
    releases: [{ identity, state: "available" }],
    draftRevision: null,
  };
  const languages = new Map([
    ["join", { source: component.code.pvo, compiled }],
  ]);
  return { identity, scope, snapshot, summary, languages };
}

export function runner(fixture) {
  let current = structuredClone(fixture.summary),
    pending = null,
    sequence = 0;
  const sent = [];
  const context = {
    signal: new AbortController().signal,
    isCurrent: () => true,
  };
  const adapters = {
    read: async () => structuredClone(current),
    send: async (value) => {
      sent.push(structuredClone(value));
      if (value.control.expectedRevision !== current.service.revision)
        throw new Error("state changed");
      current.service = {
        ...current.service,
        state: "active",
        liveReleaseId: value.control.releaseId,
        revision: current.service.revision + 1,
      };
      current.releases[0].state = "retained";
      return structuredClone(current);
    },
    pending: () => structuredClone(pending),
    save: (_ownerId, _serviceId, value) => {
      pending = structuredClone(value);
    },
    createId: () => `activation-${++sequence}`,
    now: () => now,
  };
  return {
    adapters,
    context,
    sent,
    current,
    get pending() {
      return pending;
    },
    run: () =>
      api.activateExportServices(fixture.snapshot.services, adapters, context),
  };
}
