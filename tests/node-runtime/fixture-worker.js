import { DurableObject } from "cloudflare:workers";

/** Local integration fixture only. Provider isolation is covered by the recorded Fly proof. */
export class FixtureNodeExecution extends DurableObject {
  async execute(request) {
    const response = await this.env.NODE_FIXTURE.fetch(
      "https://node-fixture.test",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    return response.json();
  }
  cancel() {
    return { ok: true };
  }
}
