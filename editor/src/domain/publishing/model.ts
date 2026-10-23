import type { ProjectSnapshot } from "../project/model";

export type ExportFormat = "video" | "pvo";
export type ExportQuality = "720p" | "1080p" | "4K";
export type ExportStage =
  | "preparing"
  | "uploading"
  | "rendering"
  | "downloading"
  | "browser"
  | "activating";
export type ExportSnapshot = ProjectSnapshot & {
  quality: ExportQuality;
  snapshotId: string;
  services?: import("../export/serviceDelivery").ExportServicePlan;
};
export type CompletedExport = {
  snapshotId: string;
  services?: import("../export/serviceDelivery").ExportServicePlan;
  blob: Blob;
  filename: string;
  contentType: string;
  format: ExportFormat;
  createdAt: string;
  coverAt: number;
  poster: Blob | null;
};

export type PublishingStatus = {
  available: boolean;
  hasSession: boolean;
  maxBytes: number;
};
export type PublicationReservation = {
  id: string;
  url: string;
  status: "pending" | "ready";
};
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
