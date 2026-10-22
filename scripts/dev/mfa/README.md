# Local word alignment

This authenticated loopback service aligns an existing English transcript to a
mono 16 kHz PCM16 WAV at its original playback rate. It does not transcribe speech
or verify that a supplied transcript is correct. The host maps returned WAV-relative
seconds through the source clip's trim, position and speed.

Install [micromamba](https://mamba.readthedocs.io/en/latest/installation/micromamba-installation.html)
without changing system Python, then create a persistent isolated runtime:

```sh
python3 scripts/dev/mfa/setup.py --micromamba /absolute/path/to/micromamba --prefix '/Users/yourname/Library/Application Support/PVO/mfa'
```

The setup pins MFA 3.4.2 and Kalpy 0.10.5, downloads checksum-pinned English MFA 3.1.0
acoustic/dictionary files, and applies a source-hash-checked refinement correction.
Original sources and the patch remain under the runtime's `stock-source/`.
The correction fixes three observed MFA 3.4.2 integration defects: canonical
utterance archive keys, loading word IDs, and refining after interval collection.
`3.4.2+pvo.refinement.1` identifies this local variant. The runner refuses different
package versions, source hashes, or model hashes; it never silently disables refinement.
Each request must also report a completed refinement pass in the pinned CLI's log.
Skipped or missing refinement fails closed even when ordinary word intervals exist.

Create a private token file readable only by its owner, then run:

```sh
node scripts/dev/mfa/server.mjs --token-file /absolute/private/service-token --mfa '/Users/yourname/Library/Application Support/PVO/mfa/env/bin/mfa' --root '/Users/yourname/Library/Application Support/PVO/mfa/mfa-root'
```

The service binds only `127.0.0.1:5198`; optional `--port` changes the port.
POST `/align` requires `Authorization: Bearer <token>` and JSON
`{audio: base64Wav, duration: seconds, text: transcript, language: "en"}`.
The response is `{text, words:[{text,start,end}], provenance}`. The provenance
records the model/runtime and always sets `transcriptVerified:false`.
There is no unauthenticated route or browser CORS permission.

Requests are limited to 60 seconds, 300 words, 4000 text characters and one active
job. Busy requests receive 429; invalid/silent/incomplete alignments receive 422.
The service rejects unsupported languages and incomplete supplied-word coverage.
It cannot detect an omitted spoken word reliably. A 110-second deadline or client
disconnect kills the whole subprocess group; owned temporary audio, text and logs
are deleted on every outcome. Request bodies, tokens and private model errors
are not written to service logs.

Run the sidecar's isolated contract and process-lifecycle tests with
`node --test tests/native-mfa-sidecar.test.mjs`. They use `python.exe` on Windows
or `python3` on macOS/Linux for the refinement-log parser, and the current Node
executable for subprocess fixtures; they do not install or run the MFA model.
Cancellation terminates a POSIX process group or uses Windows `taskkill /T /F`,
and waits for termination before removing the job directory. These tests cover
Windows cleanup, not installation or acoustic accuracy of the pinned MFA runtime.

The current CPU CLI measured 22.77 seconds for a 4-second sample, including
process/corpus setup. This is a tested local development service, not a hosted
Cloudflare deployment. Refinement uses a 1 ms feature step; that is not a guarantee
of 1 ms accuracy. See [MFA's refinement explanation](https://montreal-forced-aligner.readthedocs.io/en/latest/user_guide/implementations/fine_tune.html).
