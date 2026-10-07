import { parseTaskRecord } from "../../packages/pvo-assistant/tasks/index.js";
import {
  parseCheckedService,
  parseServicePublication,
  serializeServiceIdentity,
} from "../../packages/pvo-assistant/releases/index.js";
import {
  serializeServiceAgreement,
  serializeServiceFiles,
  serializeServicePackage,
  serializeServiceTestReport,
} from "../../packages/pvo-assistant/services/index.js";
import { contentDigest as serviceDigest } from "../contentDigest.js";
export { serviceDigest };
export const serviceIntentDigest = (identity) =>
  serviceDigest(serializeServiceIdentity(identity));
export const serviceResourceId = (identity) =>
  serviceDigest(
    JSON.stringify([
      identity.serviceId,
      identity.ownerId,
      identity.projectId,
      identity.taskId,
      identity.operationId,
    ]),
  ).then((hash) => `release-${hash}`);
export const ownedServiceId = (task) =>
  serviceDigest(
    JSON.stringify([task.ownerId, task.input.projectId, task.id]),
  ).then((hash) => `service-${hash}`);

/** Caller must retrieve the checked artifact from task-owned storage, never model/request JSON. */
export async function prepareServicePublication(
  value,
  operationId,
  checked,
  expiresAt,
  serviceId = null,
) {
  const task = parseTaskRecord(value);
  checked = parseCheckedService(checked);
  const identity = {
    serviceId: serviceId ?? (await ownedServiceId(task)),
    ownerId: task.ownerId,
    projectId: task.input.projectId,
    taskId: task.id,
    operationId,
    ...checked.artifact.identity,
    reportDigest: await serviceDigest(
      serializeServiceTestReport(
        checked.report,
        checked.artifact.agreement,
        checked.artifact.identity,
      ),
    ),
    expiresAt,
  };
  return verifyServicePublication({
    identity: { resourceId: await serviceResourceId(identity), ...identity },
    ...checked,
  });
}

/** Rehash canonical bytes at the hosting boundary. A syntactically valid digest/report is insufficient. */
export async function verifyServicePublication(value) {
  const publication = parseServicePublication(value),
    { identity, artifact, report } = publication;
  const actual = await Promise.all([
    serviceResourceId(identity),
    serviceDigest(serializeServiceAgreement(artifact.agreement)),
    serviceDigest(serializeServiceFiles(artifact.package.files)),
    serviceDigest(serializeServicePackage(artifact.package)),
    serviceDigest(
      serializeServiceTestReport(report, artifact.agreement, artifact.identity),
    ),
  ]);
  if (
    actual.some(
      (hash, index) =>
        hash !==
        [
          identity.resourceId,
          identity.agreementDigest,
          identity.sourceDigest,
          identity.packageDigest,
          identity.reportDigest,
        ][index],
    )
  )
    throw new Error(
      "Service release identity does not match its owned canonical bytes.",
    );
  return publication;
}
