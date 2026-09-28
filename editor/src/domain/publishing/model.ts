import type { ProjectSnapshot } from "../project/model";

export type ExportFormat = "video" | "pvo";
export type ExportSnapshot = ProjectSnapshot & { quality: "720p" | "1080p"; snapshotId: string };
export type CompletedExport = {
  snapshotId: string;
  blob: Blob;
  filename: string;
  contentType: string;
  format: ExportFormat;
  createdAt: string;
};

export type PublishingStatus = {
  available: boolean;
  authenticated: boolean;
  maxBytes: number;
  authUrl?: string;
  user?: { name?: string; email?: string };
};
export type PublicationReservation = { id: string; url: string; status: "pending" | "ready" };
export type Publication = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  format: ExportFormat;
  bytes: number;
};
export type PublicationInput = {
  title: string;
  filename: string;
  format: ExportFormat;
  contentType: string;
  size: number;
  idempotencyKey: string;
};
