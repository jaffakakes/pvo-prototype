import assert from "node:assert/strict";
import { parseAssistantRequest, parseAssistantResponse } from "../../../packages/pvo-assistant/index.js";

/** Only the HTTP provider is mocked; source compilation and the review workflow stay real. */
export async function installAssistantFixture(context) {
  const requests = [];
  const failures = [];
  await context.route("**/api/assistant", async route => {
    const http = route.request();
    assert.equal(http.method(), "POST");
    const request = parseAssistantRequest(http.postDataJSON());
    assert(request.context?.scenes.some(scene => scene.id === request.context.currentSceneId));
    requests.push(request);
    const status = failures.shift() ?? (/dashboard|shadow/i.test(request.prompt) ? 422 : 200);
    if (status !== 200) {
      await route.fulfill({ status, json: { error: { message: "Untrusted provider detail must stay hidden." } } });
      return;
    }
    const root = request.componentType;
    const heading = root === "card" ? "title" : root === "choice" ? "prompt" : "text";
    const styles = [];
    if (/softer/i.test(request.prompt)) styles.push(`${root} { background: #F2F0E9; color: #302F38; }`);
    if (/larger/i.test(request.prompt)) styles.push(`${heading} { font-size: 30px; }`);
    if (/bolder/i.test(request.prompt)) styles.push(`${heading} { font-weight: 700; }`);
    if (/blue/i.test(request.prompt)) styles.push(`${root} { background: #60A5FA; }`);
    assert(styles.length, `No HTTP fixture defined for: ${request.prompt}`);
    const proposal = parseAssistantResponse({
      source: { ...request.source, style: `${request.source.style}\n${styles.join("\n")}` },
      summary: "Updated the component appearance.", tags: ["Style"],
      followUps: ["Softer colours", "Larger heading", "Bolder"],
    });
    await route.fulfill({ json: proposal });
  });
  return { requests, failNext: status => failures.push(status) };
}
