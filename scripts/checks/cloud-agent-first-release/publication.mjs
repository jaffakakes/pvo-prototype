import assert from "node:assert/strict";

/** Publication storage is controlled; the real export UI uploads the exact generated PVO. */
export async function publishGeneratedArtifact({
  context,
  page,
  origin,
  subject,
  bytes,
  record,
}) {
  const uploads = [],
    reservations = [];
  const publication = {
    id: `acceptance_${subject}`,
    url: `${origin}/player/acceptance_${subject}`,
    status: "pending",
  };
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: true, hasSession: true, maxBytes: 1000000000 },
    }),
  );
  await context.route("**/api/publications**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/publications" && request.method() === "POST") {
      reservations.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: publication });
    }
    if (path.endsWith("/content")) {
      uploads.push(request.postDataBuffer());
      return route.fulfill({
        status: uploads.length === 1 ? 503 : 200,
        json:
          uploads.length === 1
            ? { error: "Deliberate acceptance upload failure" }
            : { ...publication, status: "ready" },
      });
    }
    if (path.endsWith("/poster"))
      return route.fulfill({ json: { uploaded: true } });
    return route.fulfill({ json: { publications: [] } });
  });
  const share = page.locator("[data-share-panel]");
  await share.locator("[data-share-done]").click();
  await page
    .locator("[data-export-share]")
    .filter({ visible: true })
    .first()
    .click();
  await share
    .getByText("Link sharing isn’t available yet.", { exact: true })
    .waitFor();
  await share
    .getByRole("button", { name: "Retry sharing", exact: true })
    .click();
  await share
    .getByRole("textbox", { name: "Published PVO link", exact: true })
    .waitFor();
  assert.equal(reservations.length, 2);
  assert.equal(reservations[0].idempotencyKey, reservations[1].idempotencyKey);
  assert.deepEqual(uploads, [bytes, bytes]);
  await record("publication_upload_recovered", {
    subject,
    bytes: bytes.length,
    sameArtifact: true,
    storage: "controlled fixture",
  });
  return { ...publication, bytes: uploads[1] };
}
