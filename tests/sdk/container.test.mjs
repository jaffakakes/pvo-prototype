import test from "node:test";
import assert from "node:assert/strict";
import {
  PVO_CONTAINER_MIME,
  PVO_UUID,
  inspectMp4,
  packPvo,
  packPvoProject,
  readPvo,
  readPvoProject,
  tryReadPvo,
  validatePvo,
} from "../../packages/pvo-sdk/index.js";
import { manifest } from "./manifest.fixture.mjs";

function mp4Box(type, payload = new Uint8Array()) {
  const box = new Uint8Array(8 + payload.length);
  const view = new DataView(box.buffer);
  view.setUint32(0, box.length, false);
  box.set(new TextEncoder().encode(type), 4);
  box.set(payload, 8);
  return box;
}

function makeTinyMp4({ zeroSizedMdat = false } = {}) {
  const ftyp = mp4Box(
    "ftyp",
    Uint8Array.from([
      0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1, 0x69, 0x73, 0x6f, 0x6d,
    ]),
  );
  const moov = mp4Box("moov", Uint8Array.from([1, 2, 3, 4]));
  const mdat = mp4Box("mdat", Uint8Array.from([10, 20, 30, 40, 50]));
  if (zeroSizedMdat) new DataView(mdat.buffer).setUint32(0, 0, false);
  return new Blob([ftyp, moov, mdat], { type: "video/mp4" });
}

function makeTinyMov() {
  const ftyp = mp4Box(
    "ftyp",
    Uint8Array.from([
      0x71, 0x74, 0x20, 0x20, 0, 0, 0, 1, 0x71, 0x74, 0x20, 0x20,
    ]),
  );
  const moov = mp4Box("moov", Uint8Array.from([1, 2, 3, 4]));
  const mdat = mp4Box("mdat", Uint8Array.from([10, 20, 30, 40, 50]));
  return new Blob([ftyp, moov, mdat], { type: "video/quicktime" });
}

test("packPvo and readPvo round-trip while preserving a normal MP4 fallback", async () => {
  const source = makeTinyMp4();
  const packed = await packPvo(source, manifest());
  assert.equal(packed.type, "video/mp4");

  const packedBytes = new Uint8Array(await packed.arrayBuffer());
  const boxes = inspectMp4(packedBytes);
  assert.deepEqual(
    boxes.map((box) => box.type),
    ["ftyp", "moov", "mdat", "uuid"],
  );

  const decoded = await readPvo(packed);
  assert.equal(decoded.manifest.title, "SDK test");
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.videoBlob.size, source.size);
  assert.equal(PVO_UUID, "5a125a6e-8c7a-4ba8-9dd9-5e449a275056");
});

test("packPvo preserves a MOV source and QuickTime fallback", async () => {
  const source = makeTinyMov();
  const packed = await packPvo(source, manifest());
  assert.equal(packed.type, "video/quicktime");

  const decoded = await readPvo(packed);
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.videoBlob.type, "video/quicktime");
  assert.equal(decoded.videoBlob.size, source.size);
  assert.deepEqual(
    inspectMp4(new Uint8Array(await packed.arrayBuffer())).map(
      (box) => box.type,
    ),
    ["ftyp", "moov", "mdat", "uuid"],
  );
});

test("repacking replaces the old PVO box instead of stacking manifests", async () => {
  const first = await packPvo(makeTinyMp4(), manifest());
  const changed = manifest();
  changed.title = "Replacement";
  const second = await packPvo(first, changed);
  const boxes = inspectMp4(new Uint8Array(await second.arrayBuffer()));
  assert.equal(boxes.filter((box) => box.type === "uuid").length, 1);
  assert.equal((await readPvo(second)).manifest.title, "Replacement");
});

test("packPvo repairs a final size-zero box before appending", async () => {
  const packed = await packPvo(
    makeTinyMp4({ zeroSizedMdat: true }),
    manifest(),
  );
  const boxes = inspectMp4(new Uint8Array(await packed.arrayBuffer()));
  assert.deepEqual(
    boxes.map((box) => box.type),
    ["ftyp", "moov", "mdat", "uuid"],
  );
  assert.equal(boxes[2].extendsToEnd, false);
});

test("tryReadPvo distinguishes a plain MP4", async () => {
  assert.equal(await tryReadPvo(makeTinyMp4()), null);
  await assert.rejects(() => readPvo(makeTinyMp4()), /No PVO manifest/);
});

test("self-contained .pvo packages keep the main media and every branch asset", async () => {
  const projectManifest = {
    spec_version: "0.1-prototype",
    title: "Branch package",
    initial_scene: "main_scene",
    media: [
      {
        id: "main_media",
        asset_id: "main_media",
        name: "main.mp4",
        type: "video/mp4",
      },
      {
        id: "branch_media",
        asset_id: "branch_media",
        name: "answer.mov",
        type: "video/quicktime",
      },
    ],
    playback: {
      initial_timeline: "main",
      timelines: [
        {
          id: "main",
          kind: "main",
          clips: [
            {
              id: "main_clip",
              asset_id: "main_media",
              scene: "main_scene",
              start: 0,
              end: 5,
            },
          ],
        },
        {
          id: "branch:choice",
          kind: "branch",
          clips: [
            {
              id: "branch_clip",
              asset_id: "branch_media",
              scene: "branch_scene",
              start: 0,
              end: 5,
            },
          ],
        },
      ],
    },
    scenes: [
      { id: "main_scene", asset_id: "main_media", start: 0, end: 5 },
      { id: "branch_scene", asset_id: "branch_media", start: 0, end: 5 },
    ],
    components: [
      {
        id: "choice",
        kind: "choice",
        options: [
          {
            label: "Yes",
            actions: [{ type: "goto_scene", scene: "branch_scene" }],
          },
          { label: "No", actions: [{ type: "seek", time: 0 }] },
        ],
        presentation: {
          scene: "main_scene",
          clip: "main_clip",
          timeline: "main",
          start: 1,
          end: 4,
          x: 0.2,
          y: 0.2,
          width: 0.5,
          height: 0.3,
        },
        response_policy: { dispatch: "layer_end", unanswered: "pause" },
      },
    ],
    hotspots: [],
    triggers: [],
  };
  assert.equal(validatePvo(projectManifest).valid, true);

  const main = makeTinyMp4();
  const branch = makeTinyMov();
  const packed = await packPvoProject({
    manifest: projectManifest,
    assets: [
      { id: "main_media", name: "main.mp4", file: main },
      { id: "branch_media", name: "answer.mov", file: branch },
    ],
  });
  assert.equal(packed.type, PVO_CONTAINER_MIME);

  const project = await readPvoProject(packed);
  assert.equal(project.container, true);
  assert.equal(project.assets.length, 2);
  assert.deepEqual(
    project.assets.map((asset) => [asset.id, asset.type, asset.size]),
    [
      ["main_media", "video/mp4", main.size],
      ["branch_media", "video/quicktime", branch.size],
    ],
  );
  const decoded = await readPvo(packed);
  assert.equal(decoded.container, true);
  assert.equal(decoded.videoBlob.size, main.size);
  assert.equal(decoded.manifest.playback.timelines.length, 2);
});
