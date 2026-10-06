import {
  type WorkspaceCommand,
  type WorkspaceState,
  newWorkspace,
  beginWorkspaceAction,
  parseWorkspaceIdentity,
  parseWorkspaceLease,
  parseWorkspaceRun,
  parseWorkspaceSave,
} from "../../packages/pvo-assistant/workspaces/index.js";

const identity = parseWorkspaceIdentity({});
const state: WorkspaceState = newWorkspace(identity);
const running = beginWorkspaceAction(state, {
  id: "one",
  kind: "start",
  now: 1,
});
const session: number = parseWorkspaceLease(running.lease).session;
const command: WorkspaceCommand = parseWorkspaceRun({}, true).command;
const content: string = parseWorkspaceSave({}).files[0].content;
void [session, command, content];
// @ts-expect-error tools cannot launch shells
const shell: WorkspaceCommand = { kind: "shell", paths: [] };
// @ts-expect-error a parsed start request has no command
parseWorkspaceRun({}).command;
// @ts-expect-error current-state guards require the whole action identity
beginWorkspaceAction(state, { kind: "start", now: 1 });
void shell;
