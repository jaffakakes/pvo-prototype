import {
  object,
  list,
  text,
  id,
  integer,
  choice,
  unique,
  boundedJson,
  requireTask,
  time,
} from "../tasks/validation.js";
import { parseHostedService } from "./service.js";

export const SERVICE_CONNECTION_LIMITS = Object.freeze({
  records: 65,
  exports: 64,
  components: 64,
  publications: 16,
  requestBytes: 48 * 1024,
  storedBytes: 1024 * 1024,
  bytes: 2 * 1024 * 1024,
});

/** Private dependency metadata only. Release/operation authority is resolved by the owned host. */
export function parseServiceConnectionReport(value) {
  object(
    value,
    [
      "kind",
      "referenceId",
      "projectId",
      "title",
      "expectedRevision",
      "components",
    ],
    "Container connection report",
  );
  choice(value.kind, ["project", "export"], "Connection report kind");
  id(value.referenceId, "Connection reference");
  id(value.projectId, "Connection project");
  requireTask(
    value.kind !== "project" || value.referenceId === value.projectId,
    "Project reports use their owned server project identity.",
  );
  text(value.title, 240, "Project or export title");
  integer(
    value.expectedRevision,
    Number.MAX_SAFE_INTEGER,
    "Connection revision",
  );
  list(
    value.components,
    SERVICE_CONNECTION_LIMITS.components,
    "Connected components",
  );
  for (const item of value.components) {
    object(
      item,
      [
        "sceneId",
        "sceneName",
        "componentId",
        "componentName",
        "releaseId",
        "operation",
      ],
      "Connected component",
    );
    for (const key of ["sceneId", "componentId", "releaseId", "operation"])
      id(item[key], key);
    text(item.sceneName, 240, "Scene name");
    text(item.componentName, 240, "Component name");
  }
  unique(
    value.components.map((item) => `${item.sceneId}:${item.componentId}`),
    "Connected component references",
  );
  requireTask(
    value.kind !== "export" ||
      (value.expectedRevision === 0 && value.components.length > 0),
    "An export requires its immutable connections.",
  );
  boundedJson(
    value,
    SERVICE_CONNECTION_LIMITS.requestBytes,
    "Container connection report",
  );
  return structuredClone(value);
}

export function parseServiceConnections(value) {
  object(value, ["service", "observedAt", "records"], "Container connections");
  const service = parseHostedService(value.service);
  time(value.observedAt, "Connection observation time");
  list(value.records, SERVICE_CONNECTION_LIMITS.records, "Connection records");
  const records = value.records.map((item) => {
    object(
      item,
      ["report", "revision", "recordedAt", "publications"],
      "Connection record",
    );
    const report = parseServiceConnectionReport(item.report);
    requireTask(
      report.projectId === service.identity.projectId,
      "Connection belongs to another project.",
    );
    integer(
      item.revision,
      Number.MAX_SAFE_INTEGER,
      "Saved connection revision",
      1,
    );
    time(item.recordedAt, "Connection report time");
    list(
      item.publications,
      SERVICE_CONNECTION_LIMITS.publications,
      "Published links",
    );
    for (const publication of item.publications) {
      object(publication, ["id", "title", "recordedAt"], "Published link");
      id(publication.id, "Publication ID");
      text(publication.title, 480, "Publication title");
      time(publication.recordedAt, "Publication report time");
    }
    unique(
      item.publications.map((p) => p.id),
      "Published links",
    );
    requireTask(
      report.kind === "export" || item.publications.length === 0,
      "Only exports can have published links.",
    );
    return {
      ...item,
      report,
      publications: structuredClone(item.publications),
    };
  });
  unique(
    records.map((item) => `${item.report.kind}:${item.report.referenceId}`),
    "Connection records",
  );
  boundedJson(value, SERVICE_CONNECTION_LIMITS.bytes, "Container connections");
  return { service, observedAt: value.observedAt, records };
}
