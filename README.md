# PVO — Playable Video Object

PVO is an open prototype format for interactive video. A PVO file is still an ordinary MP4: the video and audio remain untouched, while one appended metadata box describes scenes, hotspots, interface components, state, conditions, requests, and branching.

This checkpoint contains only `@pvo/sdk`: the format reader/writer, validator, data-action runtime, JSON Schema, tests, and a packed sample. It has no editor, player UI, or Restyle dependency.

## Run the prototype

Requires Node.js 22 or newer. There are no third-party runtime dependencies.

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) for the SDK documentation.

Run the checks with:

```sh
npm test
npm run check
```

## SDK

```js
import {
  packPvo,
  readPvo,
  validatePvo,
  createPvoRuntime,
} from "@pvo/sdk";

const validation = validatePvo(manifest);
const output = await packPvo(mp4File, manifest);
const decoded = await readPvo(output);
const runtime = createPvoRuntime(decoded.manifest, playerAdapters);
```

The prototype writes one top-level ISO BMFF `uuid` box. Its fixed user type is `5a125a6e-8c7a-4ba8-9dd9-5e449a275056`; the first four payload bytes are `pvom`, followed by UTF-8 JSON. Re-exporting replaces an older PVO manifest instead of stacking copies.

Exported files use `.pvo.mp4` so operating systems and normal video players continue to recognize the fallback video.

## Actions

The runtime supports `show`, `hide`, `set`, `goto_scene`, `seek`, `request`, `open_url`, `chain`, `branch`, and `custom`. Every action can carry `when`.

PVO does not define payments or business objects. A creator can make a generic `request`; their server decides whether that request books a seat, grades a quiz, starts a checkout, or does something else.

## Prototype scope

Included now: one MP4 container, scene ranges, normalized hotspot data, tooltip/card/choice/form definitions, state, conditions, response mapping, generic HTTP actions, pack/read/validate, and a host-adapted runtime.

Deferred: the visual player, editor, signatures, embedded asset packs, builder layers, indexes, offline request queues, native bindings, accounts, collaboration, payments, and AI authoring.

See [SPEC.md](./SPEC.md) for the format note and [packages/pvo-sdk/pvo-manifest.schema.json](./packages/pvo-sdk/pvo-manifest.schema.json) for the manifest schema.

## License

Apache License 2.0. The name and format are a prototype, not yet a frozen standard.
