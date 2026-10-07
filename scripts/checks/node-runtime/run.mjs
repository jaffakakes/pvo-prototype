import assert from "node:assert/strict";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";

// Historical Cloudflare Node journals remain recoverable; this path cannot create resources.
const [accountId, mode, journal, extra] = process.argv.slice(2);
assert.match(accountId ?? "", /^[a-f0-9]{32}$/);
assert.ok(
  mode === "--cleanup" && journal && extra === undefined,
  "This retired Cloudflare Node diagnostic supports only --cleanup with its recorded report.json. Use the reviewed Fly proof for new execution.",
);
const resources = await prepareResources(accountId, { resumeReport: journal });
console.log(`Historical Node cleanup journal: ${resources.reportFile}`);
await resources.cleanup();
assert.equal(
  resources.report.cleanupVerified,
  true,
  `Cleanup pending: ${resources.reportFile}`,
);
