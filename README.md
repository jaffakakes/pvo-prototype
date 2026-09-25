# PVO — Playable Video Object

PVO is an open prototype format for interactive video. A self-contained `.pvo` file stores the original main and branch media alongside a declarative manifest describing timelines, scenes, interface components, state, conditions, requests, and branching.

This repository contains the independent `@pvo/sdk` plus a small editor prototype used to exercise the format. Neither depends on Restyle.

## Run the prototype

Requires Node.js 22 or newer. There are no third-party runtime dependencies.

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) for the SDK documentation, [http://127.0.0.1:4173/editor/](http://127.0.0.1:4173/editor/) for the editor, or [http://127.0.0.1:4173/player/](http://127.0.0.1:4173/player/) for the PVO player.

Run the checks with:

```sh
npm test
npm run check
```

## SDK

```js
import {
  packPvoProject,
  readPvo,
  validatePvo,
  createPvoRuntime,
} from "@pvo/sdk";

const validation = validatePvo(manifest);
const output = await packPvoProject({
  manifest,
  assets: [
    { id: "main", file: mainVideo },
    { id: "yes_branch", file: yesVideo },
    { id: "no_branch", file: noVideo },
  ],
});
const decoded = await readPvo(output);
const runtime = createPvoRuntime(decoded.manifest, playerAdapters);
```

The current exporter writes the `PVOPACK1` container: a compact JSON header and asset index followed by the unchanged media bytes. `packPvo` and legacy `.pvo.mp4` / `.pvo.mov` reading remain available for compatibility while integrations move to the self-contained package.

New exports use the `.pvo` filename extension and `application/vnd.pvo` MIME type.

## Actions

The runtime supports `show`, `hide`, `set`, `goto_scene`, `seek`, `request`, `open_url`, `chain`, `branch`, and `custom`. Every action can carry `when`.

PVO does not define payments or business objects. A creator can make a generic `request`; their server decides whether that request books a seat, grades a quiz, starts a checkout, or does something else.

## Prototype scope

Included now: self-contained multi-media `.pvo` packages, MP4 and MOV assets, main and branch timelines, scene ranges, normalized hotspot data, tooltip/card/choice/form definitions, end-of-layer True/False branching, state, conditions, response mapping, generic HTTP actions, pack/read/validate, a host-adapted runtime, a layered editor, and a PVO player.

Deferred: animation keyframes, signatures, compression, builder layers, streaming indexes, offline request queues, native bindings, accounts, collaboration, payments, and AI authoring.

See [SPEC.md](./SPEC.md) for the format note and [packages/pvo-sdk/pvo-manifest.schema.json](./packages/pvo-sdk/pvo-manifest.schema.json) for the manifest schema.

## License

Apache License 2.0. The name and format are a prototype, not yet a frozen standard.
