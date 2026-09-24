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

- `packPvo(media, manifest)` returns an MP4 or MOV Blob with the PVO manifest appended and the source media type preserved.
- `readPvo(file)` returns `{ manifest, validation, videoBlob, fileName }`.
- `tryReadPvo(file)` returns `null` for a plain MP4 or MOV.
- `validatePvo(manifest)` returns `{ valid, errors, warnings }`.
- `createPvoRuntime(manifest, handlers)` runs actions against host-provided player adapters.

The package has no UI, server, payment, or Restyle dependency.

The JSON Schema is exported as `@pvo/sdk/schema`.
