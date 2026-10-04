import { spawn } from "node:child_process";

export function runProcess(command, args, { signal, onStdout, maxCaptureBytes = 64_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      onStdout?.(chunk);
      if (stdout.length < maxCaptureBytes) stdout += chunk.slice(0, maxCaptureBytes - stdout.length);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < maxCaptureBytes) stderr += chunk.slice(0, maxCaptureBytes - stderr.length);
    });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim() || "no diagnostics"}`));
    });
  });
}

export async function probeMedia(path, ffprobePath, signal) {
  const { stdout } = await runProcess(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration:stream=index,codec_type,width,height,duration,color_transfer,color_primaries,color_space",
    "-of", "json", path,
  ], { signal });
  let data;
  try { data = JSON.parse(stdout); }
  catch { throw new Error("FFprobe returned invalid media information."); }
  const video = data.streams?.find(stream => stream.codec_type === "video") ?? null;
  const audio = data.streams?.find(stream => stream.codec_type === "audio") ?? null;
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("The source media has no valid duration.");
  return { video, audio, duration };
}

export async function supportsFilter(ffmpegPath, filter, signal) {
  const { stdout } = await runProcess(ffmpegPath, ["-hide_banner", "-filters"], { signal, maxCaptureBytes: 1_000_000 });
  return new RegExp(`\\s${filter}\\s`).test(stdout);
}
