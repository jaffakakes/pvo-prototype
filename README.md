# PVO — Playable Video Object

PVO is an open prototype format for interactive video. A self-contained `.pvo` file stores the original main and branch media alongside a declarative manifest describing timelines, scenes, interface components, state, conditions, requests, and branching.

This repository contains the independent `@pvo/sdk`, a PVO player, and a Restyle Capture camera/editor prototype. The SDK and player do not depend on Restyle.

## Development standards and structure

Agents must follow [AGENTS.md](./AGENTS.md) and the [coding standard](./docs/engineering/coding-standards.md): one cohesive responsibility per file, readable focused modules, and business rules separated from UI and browser effects. There is no hard line limit; split by responsibility before a file becomes difficult to understand.

The [architecture map](./docs/engineering/architecture.md) describes the separate documentation, editor, player, SDK, and Rust/PVO compiler areas and their internal folders. The [current code audit](./docs/engineering/code-audit.md) records completed extractions and remaining improvements. See the [documentation index](./docs/README.md) and [build/check commands](./scripts/README.md) for the full guide.

## Run the prototype

Requires Node.js 22 or newer, Rust with the `wasm32-unknown-unknown` target, and wasm-pack for the PVO compiler. Install Node dependencies with `npm ci`; see [build prerequisites](./scripts/README.md) for the tool and browser checks.

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) for Restyle's camera/editor application, or [http://127.0.0.1:4173/player/](http://127.0.0.1:4173/player/) to open a local PVO. Mobile home keeps the existing camera design and recovered footage. At 1024px and above in landscape, home opens the create-project studio; editor reloads resume the same local project. See [editor entry and layouts](editor/README.md).

The application deployment contains no demo or PVO documentation pages. `npm run build:docs` builds the separate documentation tree into `docs-dist/docs/`. Demo media stays in the repository as development fixtures. Cloudflare publishing setup is described in the [deployment guide](./docs/engineering/cloudflare-publishing.md).

The editor opens directly into the camera. If camera access is denied, the shutter creates coloured demo clips. Recording, gallery upload, trim, split, speed, crop, mirror, text, ratio, sound and WebM export are available in the browser. Recording is unlimited. The camera defaults to 9:16 and shows and fills the selected ratio when recording; uploaded videos fit inside it without cropping. The prototype's named sound choices use generated instrumental loops because the design reference contains no audio assets. Chrome and Firefox support the browser recording/export path; use `npm run dev:editor` for live UI development.

In the editor, Components adds Tooltip, Card, Choice and Form overlays. Each component has its own violet timeline layer; Restyle authors exactly two Choice options, while the PVO language core supports two to four. Fields is the no-code route. Advanced lets creators edit only PVO Structure, Style and Logic; it does not accept free-form HTML, CSS or JavaScript. A valid Advanced edit becomes authoritative for that component, leaving Fields read-only until an explicit reset. Choice and Form pause in Try mode. An answer runs its own outcome; it does **not** imply a branch. Restyle outcomes can continue, jump within a scene, play another scene before returning, or make a request and then follow a configured success/error outcome. Projects with components can export a self-contained interactive `.pvo` package alongside a flat video. The PVO language compiler produces semantic component data and scoped renderer markup for the editor preview and player. The generated renderer remains isolated; creators do not author or package JavaScript Functions. See the [PVO language guide](./docs/language/README.md) for the accepted grammar and limits.

Run the checks with:

```sh
npm run check
npm run check:editor
npm run check:language
npm run check:language:format
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

Each Choice option owns an action or ordered action list; Form has `on_submit`. A choice may simply update state, send a request, or continue. Only an explicit routing action or optional `scene_change` changes what plays. Submitted Form values are available to templates at `state.form.<component-id>.<field-name>`. Restyle's Fields route can use them in request paths or JSON bodies.

Requests require a declared `allowed_domains` host (including the port, if any). The runtime checks the URL, forbids credential-bearing URLs and redirects, and sends only while online. A successful response can feed `on_success` actions and `{response.path}` templates; a failed/offline request runs `on_error` if configured. Without an error action it makes no playback change and is not queued. Fields request hosts are added automatically; additional hosts can be entered in the editor's project-wide More → Advanced settings. PVO Logic v0.1 offers a declarative `request({JSON})` action on a viewer interaction, not direct `fetch`. The editor preview and PVO player both display request activity.

## Prototype scope

Included now: self-contained multi-media `.pvo` packages, MP4 and MOV assets, main and branch timelines, scene ranges, normalized hotspot data, tooltip/card/choice/form definitions, end-of-layer True/False branching, state, conditions, response mapping, generic HTTP actions, pack/read/validate, the Restyle Capture editor, and a PVO player.

Deferred: animation keyframes, signatures, compression, builder layers, streaming indexes, offline request queues, native bindings, accounts, collaboration, payments, and AI authoring.

See [SPEC.md](./SPEC.md) for the format note and [packages/pvo-sdk/pvo-manifest.schema.json](./packages/pvo-sdk/pvo-manifest.schema.json) for the manifest schema.

## License

Apache License 2.0. The name and format are a prototype, not yet a frozen standard.
