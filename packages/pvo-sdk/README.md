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
