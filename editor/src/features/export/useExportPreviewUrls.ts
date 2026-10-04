import { useCallback, useEffect, useState } from "react";
import { readPvoProject } from "../../../../packages/pvo-sdk/index.js";
import type { Ratio, Scene } from "../../domain/project/model";
import type { CompletedExport } from "../../domain/publishing/model";
import { captureCoverFrame } from "./captureCoverFrame";
import { ownPreviewUrl } from "./previewUrl";

function usePreviewUrl(
  load: Parameters<typeof ownPreviewUrl>[0],
  operation: string,
) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    return ownPreviewUrl(load, setUrl, (error) =>
      console.error(`Could not preview ${operation}:`, error),
    );
  }, [load, operation]);
  return url;
}

export function useCoverPreview(
  scene: Scene | undefined,
  ratio: Ratio,
  at: number,
  enabled: boolean,
) {
  const load = useCallback(
    (signal: AbortSignal) =>
      scene && enabled ? captureCoverFrame(scene, ratio, at, signal) : null,
    [scene, ratio, at, enabled],
  );
  return usePreviewUrl(load, "export cover");
}

export function usePosterPreview(poster: Blob | null | undefined) {
  const load = useCallback(() => poster ?? null, [poster]);
  return usePreviewUrl(load, "completed export cover");
}

/** The completed flat-video URL belongs to the export session; only unpacked PVO media is owned here. */
export function useExportMediaUrl(
  artifact: CompletedExport | null,
  artifactUrl: string | null,
) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (artifact?.format !== "pvo") return null;
      const data = await readPvoProject(artifact.blob);
      signal.throwIfAborted();
      const main = data.manifest.scenes.find(
        (scene) => scene.id === data.manifest.initial_scene,
      );
      return (
        data.assets.find((asset) => asset.id === main?.asset_id)?.blob ?? null
      );
    },
    [artifact],
  );
  const unpacked = usePreviewUrl(load, "exported PVO media");
  return artifact?.format === "pvo" ? unpacked : artifact ? artifactUrl : null;
}
