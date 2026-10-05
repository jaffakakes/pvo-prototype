import { pathToFileURL } from "node:url";
import { createAccountReader, readCloudflareToken } from "./account.mjs";

const capabilities = [
  ["workerHosting", "workers/subdomain"],
  ["linuxWorkspace", "containers/applications"],
  ["platformDispatch", "workers/dispatch/namespaces"],
];

export async function checkInfrastructure(read) {
  const checks = await Promise.all(
    capabilities.map(async ([capability, path]) => {
      const response = await read(path);
      const expectedResult =
        capability === "workerHosting"
          ? typeof response.result?.subdomain === "string" &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(response.result.subdomain)
          : Array.isArray(response.result);
      const available = response.ok && expectedResult;
      let next = available
        ? "Run the controlled live proof."
        : "Check account access and API permissions.";
      if (response.status === null)
        next =
          "Retry the account check after resolving the network or response failure.";
      if (capability === "platformDispatch" && response.codes.includes(10121)) {
        next =
          "Workers for Platforms access is unavailable. Review the paid plan or evaluate Dynamic Workers.";
      }
      return {
        capability,
        available,
        httpStatus: response.status,
        errorCodes: response.codes,
        next,
      };
    }),
  );

  return {
    checkedAt: new Date().toISOString(),
    readOnly: true,
    checks,
    readyForOriginalProviderProof: checks.every((check) => check.available),
    // Listing a resource is not proof that deployment or command execution works.
    liveWorkspaceProofPassed: false,
    workspaceIndependentHostingPassed: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const accountId = process.argv[2];
    if (!/^[a-f0-9]{32}$/.test(accountId || "")) {
      throw new Error(
        "Usage: node scripts/checks/cloud-agent-infrastructure/preflight.mjs <account-id>",
      );
    }
    const token = await readCloudflareToken();
    const report = await checkInfrastructure(
      createAccountReader({ accountId, token }),
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.readyForOriginalProviderProof) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
