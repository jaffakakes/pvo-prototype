import { packageManifestFonts } from "../../../../packages/pvo-fonts/portable.js";
import { sceneDuration as sceneLength } from "../../domain/scenes/duration";
import type { PvoAssetInput } from "../../../../packages/pvo-sdk/index.js";
import { packPvoProject } from "../../../../packages/pvo-sdk/index.js";
import { total } from "../../domain/clips/timing";
import { exportServiceConnections } from "../../domain/export/serviceDelivery";
import { buildPvoManifest } from "../../domain/export/manifest";
import type { Scene } from "../../domain/project/model";
import type { ExportSnapshot } from "../../domain/publishing/model";
import { clamp } from "../../domain/project/numbers";
import { compileLanguages } from "../../infrastructure/language/compileProject";
import {
  exportVideo,
  type ExportResult,
  type VideoExportSource,
} from "../../infrastructure/media/exportVideo";
import { pvoSceneMediaSource } from "./pvoMediaSource";

export type SceneRenderer = (
  source: VideoExportSource,
  progress: (fraction: number) => void,
) => Promise<ExportResult>;

/** Render each scene's media, then package compiled PVO language interactions. */
export async function exportPvo(
  state: ExportSnapshot,
  onPct: (progress: number) => void,
  renderScene: SceneRenderer = exportVideo,
  poster: Blob | null = null,
): Promise<ExportResult> {
  const scenes = state.scenes;
  if (!scenes.length)
    throw new Error("Record or upload a clip before exporting.");
  const empty = scenes.find((scene) => total(scene.clips) <= 0);
  if (empty)
    throw new Error(
      `Add a clip to ${empty.name} before exporting the whole scene tree.`,
    );
  const languages = await compileLanguages(state);
  const connections = exportServiceConnections(state, languages);
  // Catch incomplete routes before real-time media rendering begins.
  buildPvoManifest(
    state,
    scenes.map((scene, index) => ({
      scene,
      assetId: `scene-asset-${index}`,
      name: `media/${scene.id}.webm`,
      type: "video/webm",
    })),
    languages,
    undefined,
    connections,
  );
  const duration = scenes.reduce((sum, scene) => sum + sceneLength(scene), 0);
  const assets: PvoAssetInput[] = [];
  const rendered: Array<{
    scene: Scene;
    assetId: string;
    name: string;
    type: string;
  }> = [];
  let done = 0;
  for (const [index, scene] of scenes.entries()) {
    const sceneDuration = sceneLength(scene);
    const result = await renderScene(
      pvoSceneMediaSource(state, scene),
      (progress) => {
        onPct(clamp((done + progress * sceneDuration) / duration, 0, 1));
      },
    );
    try {
      const blob = result.blob;
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      const assetId = `scene-asset-${index}`;
      const name = `media/${scene.id}.${extension}`;
      assets.push({ id: assetId, name, type: blob.type, blob });
      rendered.push({ scene, assetId, name, type: blob.type });
    } finally {
      URL.revokeObjectURL(result.url);
    }
    done += sceneDuration;
  }
  if (poster) {
    if (
      !["image/webp", "image/png"].includes(poster.type) ||
      !poster.size ||
      poster.size > 5 * 1024 * 1024
    )
      throw new Error(
        "The selected cover frame could not be packaged as an image.",
      );
    assets.push({
      id: "poster",
      name: `images/cover.${poster.type === "image/png" ? "png" : "webp"}`,
      type: poster.type,
      blob: poster,
    });
  }
  const manifest = buildPvoManifest(
    state,
    rendered,
    languages,
    poster
      ? { id: "poster", type: poster.type as "image/png" | "image/webp" }
      : undefined,
    connections,
  );
  for (const scene of scenes)
    for (const component of scene.components) {
      const base = `components/${component.id}`;
      const language = languages.get(component.id);
      if (!language)
        throw new Error(
          `${scene.name} · ${component.type}: PVO language was not compiled.`,
        );
      for (const [part, name] of [
        [language.source.structure, "structure.pvo"],
        [language.source.style, "style.pvo"],
        [language.source.logic, "logic.pvo"],
      ] as const) {
        const path = `${base}/${name}`;
        // The container rejects zero-byte assets; whitespace is equivalent to empty Style/Logic.
        assets.push({
          id: path,
          name: path,
          type: "text/plain",
          blob: new Blob([part || " "], { type: "text/plain" }),
        });
      }
    }
  const packaged = packageManifestFonts(manifest);
  const blob = await packPvoProject({
    manifest: packaged.manifest,
    assets: [...assets, ...packaged.assets],
  });
  onPct(1);
  return { blob, url: URL.createObjectURL(blob), name: "restyle-video.pvo" };
}
