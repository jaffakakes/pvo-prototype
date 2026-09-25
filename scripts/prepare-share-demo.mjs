import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { packPvoProject, readPvo } from "../packages/pvo-sdk/index.js";

const run = promisify(execFile);
const [sourceArg, outputArg, previewArg] = process.argv.slice(2);

if (!sourceArg || !outputArg || !previewArg) {
  throw new Error("Usage: node scripts/prepare-share-demo.mjs <source.pvo> <output.pvo> <preview.mp4>");
}

const sourcePath = resolve(sourceArg);
const outputPath = resolve(outputArg);
const previewPath = resolve(previewArg);
const work = await mkdtemp(join(tmpdir(), "pvo-share-"));

try {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await mkdir(resolve(previewPath, ".."), { recursive: true });
  const decoded = await readPvo(new Blob([await readFile(sourcePath)]));
  const manifest = structuredClone(decoded.manifest);
  const prepared = [];

  for (const asset of decoded.assets) {
    const inputPath = join(work, `${asset.id}${extname(asset.name) || ".mov"}`);
    const outputMediaPath = join(work, `${asset.id}.mp4`);
    await writeFile(inputPath, new Uint8Array(await asset.blob.arrayBuffer()));
    await run("ffmpeg", [
      "-y", "-i", inputPath,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='min(720,iw)':-2",
      "-c:v", "libx264", "-preset", "medium", "-crf", "25",
      "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-movflags", "+faststart", "-map_metadata", "-1",
      outputMediaPath,
    ], { maxBuffer: 1024 * 1024 * 8 });

    const data = await readFile(outputMediaPath);
    prepared.push({ id: asset.id, name: `${asset.id}.mp4`, type: "video/mp4", data });
    const media = (manifest.media || []).find((item) => (item.asset_id || item.id) === asset.id);
    if (media) {
      media.name = `${asset.id}.mp4`;
      media.type = "video/mp4";
    }
    if (asset.id === "media_1") await writeFile(previewPath, data);
  }

  manifest.title = manifest.title || basename(sourcePath, extname(sourcePath));
  const packed = await packPvoProject({ manifest, assets: prepared });
  await writeFile(outputPath, new Uint8Array(await packed.arrayBuffer()));
} finally {
  await rm(work, { recursive: true, force: true });
}
