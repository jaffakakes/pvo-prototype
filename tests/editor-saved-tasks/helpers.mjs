import { buildSync } from "esbuild";
export const api = await import(
  `data:text/javascript;base64,${Buffer.from(
    buildSync({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    export * from './editor/src/domain/assistant/taskProjectLink.ts';
    export * from './editor/src/domain/project/mediaReferences.ts';
    export * from './editor/src/domain/assistant/native/context.ts';
    export * from './editor/src/domain/assistant/native/batch.ts';
    export * from './editor/src/features/assistant/saved-tasks/applicationWorkflow.ts';
    export * from './editor/src/state/assistant/taskProjectCommands.ts';
    export * from './editor/src/state/assistant/taskResultCommands.ts';
    export * from './editor/src/infrastructure/assistant/savedResultTransport.ts';
    export { useCapture } from './editor/src/state/captureStore.ts';
    export { useAuthGate } from './editor/src/state/auth/authGateStore.ts';
    export { useEditorPreferences } from './editor/src/state/preferences/editorPreferences.ts';
    export * from './editor/src/domain/assistant/cloudTaskInput.ts';
    export * from './editor/src/features/assistant/saved-tasks/creationWorkflow.ts';
    export * from './editor/src/features/assistant/saved-tasks/taskSession.ts';
    export * from './editor/src/infrastructure/assistant/savedTaskTransport.ts';
    export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
    export { initial } from './editor/src/state/project/initial.ts';
    export { projectSnapshot } from './editor/src/state/project/history.ts';
  `,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
    }).outputFiles[0].text,
  ).toString("base64")}`
);
export const proposal = {
  examples: [
    {
      id: "accepted",
      input: "A friend accepts",
      expected: "Their response is saved",
    },
  ],
};
export const project = () => api.projectSnapshot(api.initial());
export function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
