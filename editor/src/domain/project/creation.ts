import type { Ratio } from "./model";

export const UNTITLED_PROJECT = "Untitled edit";
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

export function projectName(value: string): string {
  return value.trim().slice(0, 120) || UNTITLED_PROJECT;
}

export function nameFromFile(filename: string): string {
  return projectName(filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
}

export function mediaIssue(file: { name: string; size: number; type: string }): string | null {
  if (file.size > MAX_VIDEO_BYTES) return `${file.name} is larger than 2 GB.`;
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|hevc)$/i.test(file.name))
    return `${file.name} isn't a supported video.`;
  return null;
}

export const RATIO_HINTS: Record<Ratio, string> = {
  "9:16": "TikTok · Reels · Shorts",
  "1:1": "Square feed post",
  "4:5": "Instagram feed",
  "16:9": "YouTube · landscape",
};
