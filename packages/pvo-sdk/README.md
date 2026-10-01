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
  describeRequestFailure,
  resolveTextTemplate,
} from "@pvo/sdk";
```

- `packPvoProject({ manifest, assets })` returns one self-contained `.pvo` Blob containing all main and branch media.
- `readPvoProject(file)` returns `{ manifest, validation, assets }` for the self-contained package.
- `readPvo(file)` reads both current `.pvo` packages and legacy PVO-in-MP4/MOV files.
- `packPvo(media, manifest)` returns an MP4 or MOV Blob with the PVO manifest appended and the source media type preserved.
- `tryReadPvo(file)` returns `null` for a plain MP4 or MOV.
- `validatePvo(manifest)` returns `{ valid, errors, warnings }`.
- `createPvoRuntime(manifest, handlers)` runs actions against host-provided player adapters.
- `describeRequestFailure(error)` returns a short, viewer-safe failure kind and message for editor and player UI.
- `resolveTextTemplate(text, context)` safely resolves scalar state/response values for display text.

The package has no UI, server, payment, or Restyle dependency.

The JSON Schema is exported as `@pvo/sdk/schema`.

`PvoScene.parent` optionally describes scene ownership: a scene ID for a branch and `null` for the single root. Parent metadata is either declared on every scene or omitted on every scene. When declared, it must identify one root, reference existing scenes, and contain no cycles. Packaging preserves the whole tree and its scene media; it does not infer parentage from action routes.

Every card, choice, and form declares `response_policy: { dispatch, unanswered }` and a timed `presentation`; tooltips do not. Dispatch is either `interaction` or `layer_end`, and an unanswered layer either `continue`s or `pause`s. These choices are independent. Routing still requires an explicit `goto_scene` or `seek` action.

Requests may store GET or POST results through `into`; Restyle uses `responses.<component-id>`. A tooltip can display that state with a text template such as `{state.responses.component-1.message}`, and a host re-resolves a visible tooltip after state changes.

A request has a 15-second deadline covering the host call and response parsing. Its `request_error` event includes `failure: { kind, status?, message }` for user feedback, alongside the existing diagnostic `error` string and `handled` flag. `on_error` actions still receive `{response.error}` and run as authored; caller cancellation emits no request error. The runtime never retries a request automatically.

The reference Restyle player follows the format note for every package. A selected scene plays to its end, `restyle_capture` carries layout only, and the SDK's `gotoScene` handler remains the integration boundary. See the [format note](../../SPEC.md) for playback and export contracts.
