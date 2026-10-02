import type { AppliedFont } from "./index.js";
export type PackagedFontAsset = { id: string; name: string; type: string; blob: Blob };
export function packageManifestFonts<T>(manifest: T): { manifest: T; assets: PackagedFontAsset[] };
export function restoreManifestFonts(decoded: { manifest: object; assets: PackagedFontAsset[] }): Promise<AppliedFont[]>;
