import assert from "node:assert/strict";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";

const preparedPrefix = "Editor prepared these validated operations on a working copy: ";
const preparedSuffix = ". These changes are not committed yet. Inspect the current project, finish the remaining request, or return a final answer when it is complete. Do not repeat prepared operations.";

export function preparedAssistantBatches(request) {
  return request.history.filter(item => item.role === "assistant" && item.content.startsWith(preparedPrefix))
    .map(item => {
      assert(item.content.endsWith(preparedSuffix), "Prepared-operation evidence must use the workflow receipt");
      return JSON.parse(item.content.slice(preparedPrefix.length, -preparedSuffix.length));
    });
}

/** Single-step fixtures finish after seeing the real validated working copy. */
export async function finishAssistantVerification(route, request) {
  const batches = preparedAssistantBatches(request);
  if (!batches.length) return false;
  assert.equal(batches.length, 1, "This fixture prepares exactly one batch before confirming completion");
  await route.fulfill({ json: parseNativeTurnResult({
    message: "The requested changes are complete.", operations: [], observations: [],
  }) });
  return true;
}

export function selectedAssistantComponent(request) {
  const scene = request.project.scenes.find(item => item.id === request.project.currentSceneId);
  const component = scene?.components.find(item => item.id === request.project.selection.componentId);
  assert(component, "The native request must identify its selected component");
  assert(component.source || component.design, "This appearance fixture needs the selected component's canonical design");
  return { scene, component };
}

export function componentSourceResult(request, source, message = "Updated the component appearance.") {
  const { scene, component } = selectedAssistantComponent(request);
  return parseNativeTurnResult({ message, observations: [], operations: [{
    kind: "component.source", sceneId: scene.id, componentId: component.id, source,
  }] });
}

/** Only the HTTP provider is mocked; compilation and atomic workflow application stay real. */
export async function installAssistantFixture(context) {
  const requests = [];
  const verificationRequests = [];
  const failures = [];
  await context.route("**/api/assistant/turn", async route => {
    const http = route.request();
    assert.equal(http.method(), "POST");
    const request = parseNativeTurnRequest(http.postDataJSON());
    assert.equal(request.mode, "plan", "The provider prepares one validated atomic batch before the host applies it");
    if (await finishAssistantVerification(route, request)) {
      verificationRequests.push(request);
      return;
    }
    requests.push(request);
    const status = failures.shift() ?? (/dashboard|shadow/i.test(request.prompt) ? 422 : 200);
    if (status !== 200) {
      await route.fulfill({ status, json: { error: { message: "Untrusted provider detail must stay hidden." } } });
      return;
    }
    const { scene, component } = selectedAssistantComponent(request);
    const root = component.type;
    const heading = root === "card" ? "title" : root === "choice" ? "prompt" : "text";
    const styles = [];
    if (/softer/i.test(request.prompt)) styles.push(`${root} { background: #F2F0E9; color: #302F38; }`);
    if (/larger/i.test(request.prompt)) styles.push(`${heading} { font-size: 30px; }`);
    if (/bolder/i.test(request.prompt)) styles.push(`${heading} { font-weight: 700; }`);
    if (/blue/i.test(request.prompt)) styles.push(`${root} { background: #60A5FA; }`);
    assert(styles.length, `No HTTP fixture defined for: ${request.prompt}`);
    await route.fulfill({ json: parseNativeTurnResult({
      message: "Updated the component appearance.", observations: [],
      operations: [{ kind: "component.style", sceneId: scene.id, componentId: component.id,
        style: `${(component.source ?? component.design).style}\n${styles.join("\n")}` }],
    }) });
  });
  return { requests, verificationRequests, failNext: status => failures.push(status) };
}
