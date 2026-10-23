import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";

const [accountId, resumeReport] = process.argv.slice(2);
if (
  process.argv.length !== 4 ||
  !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
  !resumeReport
) {
  console.error(
    "Usage: node scripts/checks/cloud-agent-first-release/cleanup.mjs <account-id> <private-report.json>",
  );
  process.exit(1);
}
const resources = await prepareResources(accountId, { resumeReport });
await resources.cleanup();
console.log(
  JSON.stringify({
    cleanupVerified: resources.report.cleanupVerified,
    reportFile: resources.reportFile,
  }),
);
if (!resources.report.cleanupVerified) process.exitCode = 1;
