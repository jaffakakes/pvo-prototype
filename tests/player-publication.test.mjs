import test from "node:test";
import assert from "node:assert/strict";
import { readPublication } from "../player/publication/metadata.js";
import { createPublicationSharing } from "../player/publication/sharing.js";

const id = "publication_123456789";
const origin = "https://video.example";
const canonical = `${origin}/player/${id}`;
const data = { shareable: "true", publicationId: id, publicationFormat: "video",
  publicationType: "video/mp4", publicationSrc: `/media/${id}` };

test("published MP4, WebM and PVO use server metadata and their canonical link", () => {
  for (const [format, contentType] of [["video", "video/mp4"], ["video", "video/webm"], ["pvo", "application/vnd.pvo"]]) {
    const result = readPublication({ ...data, publicationFormat: format, publicationType: contentType },
      `${canonical}?src=/other.pvo#seek`, canonical);
    assert.deepEqual(result, { id, format, contentType, mediaUrl: `${origin}/media/${id}`, canonicalUrl: canonical });
  }
});

test("standalone files and source query strings do not imply a shareable publication", () => {
  assert.equal(readPublication({}, `${origin}/player/?src=/demo.pvo`), null);
  assert.equal(readPublication({ ...data, shareable: "false" }, canonical, canonical), null);
});

test("publication metadata cannot substitute external media, IDs, routes or unsupported formats", () => {
  for (const patch of [
    { publicationId: "../private" }, { publicationSrc: "https://other.example/video.mp4" },
    { publicationSrc: `/media/${id}?other=1` }, { publicationSrc: "/api/private" },
    { publicationSrc: "/media/another_publication" }, { publicationFormat: "html" },
    { publicationType: "text/html" },
  ]) assert.throws(() => readPublication({ ...data, ...patch }, canonical, canonical), /invalid|unavailable/);
  for (const url of [`${origin}/editor/`, `https://elsewhere.example/player/${id}`, `${canonical}?src=x`]) {
    assert.throws(() => readPublication(data, canonical, url), /invalid/);
  }
});

test("sharing copies the canonical publication URL and hides controls for local files", async t => {
  const copied = [];
  const notices = [];
  const button = { hidden: true };
  const sharing = createPublicationSharing({ publication: readPublication(data, canonical, canonical),
    buttons: [button], title: "My video", capabilities: { clipboard: { writeText: async value => copied.push(value) } },
    setStatus: (...args) => notices.push(args) });
  t.after(sharing.destroy);
  assert.equal(button.hidden, false);
  assert.equal(await sharing.share(), true);
  assert.deepEqual(copied, [canonical]);
  assert.deepEqual(notices, [["Link copied", false, true]]);
  const local = createPublicationSharing({ publication: null, buttons: [button], title: "Local video",
    capabilities: { share: async () => assert.fail("A local file must never share this page's URL") },
    setStatus: () => assert.fail("A local file must never report a copied link") });
  t.after(local.destroy);
  assert.equal(button.hidden, true);
  assert.equal(await local.share(), false);
});

test("native sharing uses the same canonical link and cancellation stays quiet", async t => {
  const sent = [];
  const sharing = createPublicationSharing({ publication: readPublication(data, canonical, canonical),
    title: "My video", setStatus: () => assert.fail("Cancelling the share sheet is not an error"),
    capabilities: { share: async value => { sent.push(value); throw new DOMException("Cancelled", "AbortError"); } } });
  t.after(sharing.destroy);
  assert.equal(await sharing.share(), false);
  assert.deepEqual(sent, [{ title: "My video", url: canonical }]);
});

test("leaving during clipboard work suppresses stale success and releases its timer", async () => {
  let complete;
  const sharing = createPublicationSharing({ publication: readPublication(data, canonical, canonical), title: "Video",
    capabilities: { clipboard: { writeText: () => new Promise(resolve => { complete = resolve; }) } },
    setStatus: () => assert.fail("A destroyed player must not receive a status") });
  const pending = sharing.share();
  sharing.destroy();
  complete();
  assert.equal(await pending, false);
  assert.equal(await sharing.share(), false);
});
