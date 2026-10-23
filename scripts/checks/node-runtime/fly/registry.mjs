import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

/** Remove only this journal's immutable diagnostic image; never change the user's Docker login. */
export async function removeProofImage(resources, token) {
  const { report, save } = resources;
  const image = report.build?.image ?? report.registryIntent;
  if (!image) return;
  assert.match(
    image,
    new RegExp(
      `^registry\\.fly\\.io/${report.app}(?:@sha256:[a-f0-9]{64}|:runtime)$`,
    ),
  );
  const directory = await mkdtemp(join(tmpdir(), "restyle-registry-cleanup-"));
  try {
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        auths: {
          "registry.fly.io": {
            auth: Buffer.from(`x:${token}`).toString("base64"),
          },
        },
      }),
      { mode: 0o600 },
    );
    const crane = process.env.RESTYLE_CRANE_BIN;
    assert.ok(
      crane,
      "Set RESTYLE_CRANE_BIN to the verified local crane binary",
    );
    const options = {
      env: { PATH: process.env.PATH, DOCKER_CONFIG: directory },
      timeout: 45000,
      maxBuffer: 32768,
    };
    const run = promisify(execFile);
    try {
      await run(crane, ["delete", image], options);
      report.registryCleanup = {
        deleteAccepted: true,
        blobCollectionVerified: false,
      };
      try {
        await run(crane, ["digest", image], options);
        report.registryCleanup.manifestAbsent = false;
      } catch (error) {
        report.registryCleanup.manifestAbsent =
          /MANIFEST_UNKNOWN|NAME_UNKNOWN/.test(String(error.stderr));
      }
    } catch (error) {
      report.registryCleanup = {
        deleteAccepted: false,
        blobCollectionVerified: false,
        reason: /UNSUPPORTED|405|unsupported/i.test(String(error.stderr))
          ? "provider_does_not_support_delete"
          : "delete_unconfirmed",
      };
    }
    await save();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
