# `@pvo/sdk`

The browser-native prototype SDK for Playable Video Objects.

```js
import {
  packPvoProject,
  packPvo,
  readPvoProject,
  readPvo,
  tryReadPvo,
  validatePvo,
  createPvoRuntime,
} from "@pvo/sdk";
```

- `packPvoProject({ manifest, assets })` returns one self-contained `.pvo` Blob containing all main and branch media.
- `readPvoProject(file)` returns `{ manifest, validation, assets }` for the self-contained package.
- `readPvo(file)` reads both current `.pvo` packages and legacy PVO-in-MP4/MOV files.
- `packPvo(media, manifest)` returns an MP4 or MOV Blob with the PVO manifest appended and the source media type preserved.
- `tryReadPvo(file)` returns `null` for a plain MP4 or MOV.
- `validatePvo(manifest)` returns `{ valid, errors, warnings }`.
- `createPvoRuntime(manifest, handlers)` runs actions against host-provided player adapters.

The package has no UI, server, payment, or Restyle dependency.

The JSON Schema is exported as `@pvo/sdk/schema`.

`PvoScene.parent` optionally describes scene ownership: a scene ID for a branch and `null` for the single root. When supplied, the metadata must be complete for all scenes, reference existing scenes, and contain no cycles. Legacy manifests that omit all parent metadata remain supported. Packaging preserves the whole tree and its scene media; it does not infer parentage from action routes.

The reference Restyle player follows the format note for every package: explicit `goto_scene` and `seek` actions route at once, `scene_change` branches when the component layer ends, and a selected branch plays to its end. `restyle_capture` carries layout only. The SDK's `gotoScene` handler remains the integration boundary. See the [format note](../../SPEC.md) for playback and export contracts.
