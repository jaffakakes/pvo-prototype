import assert from "node:assert/strict";

/** Runs within the saved-result fixture, using its actual compiled form, HTTP host and local storage. */
export async function checkComponentTry({
  context,
  fixture,
  origin,
  getPage,
  reopen,
}) {
  const wires = [];
  let loseReply = true;
  const pattern =
    /\/api\/services\/service-[a-f0-9]{64}\/releases\/release-[a-f0-9]{64}\/try$/;
  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    wires.push(request.postData());
    const response = await fixture.request(url.pathname, {
      method: request.method(),
      body: request.postDataJSON(),
      headers: { Origin: origin },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (loseReply) {
      loseReply = false;
      await route.abort("connectionfailed");
    } else
      await route.fulfill({ status: response.status, json: response.body });
  };
  await context.route(pattern, routeHandler);
  async function start() {
    await getPage().evaluate(async () => {
      const mode = await import("/src/features/preview/tryMode.ts");
      window.resultProbe.tryMode = mode;
      window.resultProbe.tryFeedback =
        await import("/src/features/preview/tryFeedbackStore.ts");
      const state = window.resultProbe.useCapture.getState();
      state.patch({ t: 0 });
      mode.startTry();
      window.resultProbe.useCapture.getState().patch({ playing: false });
    });
  }
  async function submit(name) {
    const frame = getPage()
      .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame();
    await frame.getByRole("textbox").fill(name);
    await frame.getByRole("button", { name: "Join", exact: true }).click();
  }
  async function saved() {
    return getPage().evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("restyle-service-submissions");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction("submissions", "readonly");
            const request = transaction.objectStore("submissions").getAll();
            transaction.oncomplete = () => {
              db.close();
              resolve(request.result);
            };
            transaction.onerror = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
    );
  }
  async function stop() {
    await getPage().evaluate(async () =>
      (await import("/src/features/preview/tryMode.ts")).stopTry(),
    );
  }
  try {
    await start();
    await submit("{state.private.name}");
    await getPage().waitForFunction(() =>
      Object.values(
        window.resultProbe.tryFeedback.useTryFeedback.getState().components,
      ).some((value) => value.phase === "failed"),
    );
    assert.equal(wires.length, 1);
    const [pending] = await saved();
    assert.equal(pending.response, null);
    assert.deepEqual(pending.action.input, { name: "{state.private.name}" });
    await stop();
    await reopen();
    assert.deepEqual(await saved(), [pending]);
    await start();
    await getPage()
      .getByRole("button", { name: "Check saved test", exact: true })
      .click();
    await getPage().waitForFunction(() =>
      Object.values(
        window.resultProbe.tryMode.getTryRuntime()?.state.responses ?? {},
      ).some((value) => value.result === "accepted"),
    );
    assert.equal(wires.length, 2);
    assert.equal(wires[1], wires[0]);
    const [completed] = await saved();
    assert.deepEqual(completed.response, {
      actionId: pending.action.actionId,
      result: "accepted",
    });
    await stop();
    await start();
    await submit("Bob");
    await getPage().waitForFunction(() =>
      Object.values(
        window.resultProbe.tryMode.getTryRuntime()?.state.responses ?? {},
      ).some((value) => value.result === "full"),
    );
    assert.equal(wires.length, 3);
    assert.notEqual(JSON.parse(wires[2]).actionId, pending.action.actionId);
    const result = await fixture.request(
      `/api/services/${pending.target.serviceId}/try`,
      {
        body: {
          actionId: "inspect-component-try",
          operation: "guests",
          input: null,
        },
      },
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.result, ["{state.private.name}"]);
    const summary = await fixture.request(
      `/api/services/${pending.target.serviceId}`,
    );
    assert.equal(
      summary.body.summary.service.liveReleaseId,
      null,
      "Try must not activate live hosting",
    );
    await stop();
    console.log(
      "Component Try passed real compiler/iframe input, saved intent, lost successful HTTP reply, page + server restart, exact replay and distinct next action with inactive hosting.",
    );
  } finally {
    await context.unroute(pattern, routeHandler);
  }
}
