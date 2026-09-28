import { useEffect, useRef, useState } from "react";
import { mediaIssue } from "../../domain/project/creation";
import type { Clip } from "../../domain/project/model";
import { readVideoMetadata } from "../../infrastructure/media/readVideo";
import { mkClip } from "../../state/editing/clipFactory";

export type PreparedMedia = { file: File; clip: Clip };

/** Staged URLs belong here until the create command transfers them to the project. */
export function useProjectMedia() {
  const [media, setMedia] = useState<PreparedMedia[]>([]);
  const [progress, setProgress] = useState<{ done: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owned = useRef(new Set<string>());
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    owned.current.forEach(url => URL.revokeObjectURL(url));
    owned.current.clear();
  }, []);

  const prepare = async (files: readonly File[], controller: AbortController) => {
    const ready: PreparedMedia[] = [];
    const issues: string[] = [];
    setProgress({ done: 0, count: files.length });
    for (const file of files) {
      controller.signal.throwIfAborted();
      const issue = mediaIssue(file);
      if (issue) issues.push(issue);
      else {
        const url = URL.createObjectURL(file);
        owned.current.add(url);
        try {
          const data = await readVideoMetadata(url, controller.signal);
          ready.push({ file, clip: mkClip(data.duration, url, media.length + ready.length, data.width, data.height) });
        } catch (error) {
          URL.revokeObjectURL(url);
          owned.current.delete(url);
          controller.signal.throwIfAborted();
          issues.push(`${file.name}: ${error instanceof Error ? error.message : "Couldn't read this video."}`);
        }
      }
      setProgress(previous => previous && { ...previous, done: previous.done + 1 });
    }
    setMedia(previous => [...previous, ...ready]);
    setError(issues.length ? issues.join(" ") : null);
    return ready;
  };

  const run = async (getFiles: (signal: AbortSignal) => Promise<readonly File[]>) => {
    if (active.current) return [];
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setProgress({ done: 0, count: 0 });
    try { return await prepare(await getFiles(controller.signal), controller); }
    catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't load the clips. Try again.");
      return [];
    } finally {
      if (!controller.signal.aborted) setProgress(null);
      if (active.current === controller) active.current = null;
    }
  };

  return {
    media, progress, error,
    addFiles: (files: readonly File[]) => run(async () => files),
    loadSample: () => run(async signal => {
      const response = await fetch(new URL("./samples/restyle-sample.mp4", location.href), { signal });
      if (!response.ok) throw new Error("The sample couldn't load. Try uploading a clip.");
      return [new File([await response.blob()], "Restyle sample.mp4", { type: "video/mp4" })];
    }),
    transfer: (media: PreparedMedia[]) => media.forEach(item => { if (item.clip.url) owned.current.delete(item.clip.url); }),
    discard: (items: PreparedMedia[]) => {
      const ids = new Set(items.map(item => item.clip.id));
      for (const { clip } of items) {
        if (clip.url && owned.current.delete(clip.url)) URL.revokeObjectURL(clip.url);
      }
      setMedia(previous => previous.filter(item => !ids.has(item.clip.id)));
    },
    remove: (id: number) => {
      const item = media.find(item => item.clip.id === id);
      if (item?.clip.url) { URL.revokeObjectURL(item.clip.url); owned.current.delete(item.clip.url); }
      setMedia(previous => previous.filter(item => item.clip.id !== id));
    },
  };
}
