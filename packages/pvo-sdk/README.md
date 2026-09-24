# `@pvo/sdk`

The browser-native prototype SDK for Playable Video Objects.

```js
import {
  packPvo,
  readPvo,
  tryReadPvo,
  validatePvo,
  createPvoRuntime,
} from "@pvo/sdk";
```

- `packPvo(mp4, manifest)` returns a normal `video/mp4` Blob with the PVO manifest appended.
- `readPvo(file)` returns `{ manifest, validation, videoBlob, fileName }`.
- `tryReadPvo(file)` returns `null` for a plain MP4.
- `validatePvo(manifest)` returns `{ valid, errors, warnings }`.
- `createPvoRuntime(manifest, handlers)` runs actions against host-provided player adapters.

The package has no UI, server, payment, or Restyle dependency.

The JSON Schema is exported as `@pvo/sdk/schema`.
