import type { ProjectSnapshot } from "../project/model";
import { PVO_CONTAINER_MIME } from "../../../../packages/pvo-sdk/index.js";
import { cloneScenes } from "../project/snapshot";
import { exportCoverAt } from "../project/cover";
import type {
  CompletedExport,
  ExportFormat,
  ExportSnapshot,
  PublicationInput,
  PublishingStatus,
} from "./model";

export function captureExportSnapshot(
  source: ProjectSnapshot & {
    quality: ExportSnapshot["quality"];
    services?: ExportSnapshot["services"];
  },
  snapshotId: string,
): ExportSnapshot {
  return {
    snapshotId,
    ...(source.services ? { services: structuredClone(source.services) } : {}),
    quality: source.quality,
    ratio: source.ratio,
    coverAt: exportCoverAt(source),
    currentSceneId: source.currentSceneId,
    scenes: cloneScenes(source.scenes),
    allowedDomains: source.allowedDomains.slice(),
  };
}

export function publicationInput(
  artifact: CompletedExport,
  title: string,
  status: PublishingStatus,
  idempotencyKey: string,
): PublicationInput {
  if (!status.available) throw new Error("Link sharing isn’t available yet.");
  if (!status.hasSession) throw new Error("Sign in to create a link.");
  if (!artifact.blob.size || artifact.blob.size > status.maxBytes)
    throw new Error("This file exceeds the online size limit.");
  const cleaned = title.trim();
  if (!cleaned || cleaned.length > 120)
    throw new Error("Use a title of 1–120 characters.");
  return {
    title: cleaned,
    filename: artifact.filename,
    format: artifact.format,
    contentType: artifact.contentType,
    size: artifact.blob.size,
    idempotencyKey,
  };
}

export function completedExport(
  snapshot: ExportSnapshot,
  format: ExportFormat,
  result: { blob: Blob; name: string },
  createdAt: string,
  poster: Blob | null = null,
): CompletedExport {
  if (!result.blob.size) throw new Error("The exported file was empty.");
  return {
    snapshotId: snapshot.snapshotId,
    blob: result.blob,
    filename: result.name,
    format,
    contentType:
      format === "pvo"
        ? PVO_CONTAINER_MIME
        : result.blob.type.split(";")[0] || "video/webm",
    createdAt,
    coverAt: snapshot.coverAt,
    poster,
    ...(format === "pvo" && snapshot.services
      ? { services: structuredClone(snapshot.services) }
      : {}),
  };
}
