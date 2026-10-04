import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const origin = process.env.PVO_RENDER_ORIGIN || "http://127.0.0.1:4173";
const cookie = process.env.PVO_RENDER_COOKIE || "";
const ffmpeg = process.env.PVO_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.PVO_FFPROBE_PATH || "ffprobe";
const temporary = await mkdtemp(join(tmpdir(), "restyle-server-render-check-"));

async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${detail}`);
  }
  return response;
}

function scene(quality) {
  return {
    ratio: "9:16", quality,
    clips: [{ id: 1, url: "source_1", color: "#000000", srcDur: 2,
      in: 0.25, out: 1.75, speed: 1.5, zoom: 1, mirror: false,
      width: 1080, height: 1920, fit: "cover" }],
    audioClips: [], texts: [], components: [], layers: ["video"], muted: false, sound: 0,
  };
}

async function waitForJob(id, cookie) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await (await request(`/api/renders/${id}`, { headers: { Cookie: cookie } })).json();
    if (status.status === "ready") return status;
    if (status.status === "failed" || status.status === "cancelled")
      throw new Error(`Server render ${id} ${status.status}: ${status.error || "no details"}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server render ${id} did not finish within 90 seconds.`);
}

try {
  assert.ok(cookie, "Set PVO_RENDER_COOKIE to the local beta Google account session cookie.");
  const account = await (await request("/api/auth/session", { headers: { Cookie: cookie } })).json();
  assert.ok(account.available && account.user, "PVO_RENDER_COOKIE must contain an active local beta Google account session.");
  const input = join(temporary, "source.mp4");
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=523:sample_rate=48000",
    "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", input], { maxBuffer: 4 * 1024 * 1024 });
  const bytes = await readFile(input);
  const availability = await (await request("/api/renders")).json();
  assert.equal(availability.available, true, "local render service must be available");
  for (const quality of ["720p", "1080p", "4K"]) {
    const creation = await request("/api/renders", {
      method: "POST", headers: { Origin: origin, Cookie: cookie,
        "Content-Type": "application/json" },
      body: JSON.stringify({ source: scene(quality), assets: [{ id: "source_1", bytes: bytes.length, contentType: "video/mp4" }] }),
    });
    const created = await creation.json();
    assert.match(created.id, /^[a-f0-9]{32}$/);
    const ownerOnly = await fetch(new URL(`/api/renders/${created.id}`, origin));
    assert.equal(ownerOnly.status, 401, "another browser must not see the render");
    await request(`/api/renders/${created.id}/sources/source_1`, {
      method: "PUT", headers: { Origin: origin, Cookie: cookie, "Content-Type": "video/mp4" }, body: bytes,
    });
    await request(`/api/renders/${created.id}/start`, { method: "POST", headers: { Origin: origin, Cookie: cookie } });
    const status = await waitForJob(created.id, cookie);
    const output = join(temporary, `${quality}.mp4`);
    await writeFile(output, Buffer.from(await (await request(status.resultUrl, { headers: { Cookie: cookie } })).arrayBuffer()));
    const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", 
      "-show_entries", "format=duration", "-of", "json", output]);
    const probe = JSON.parse(stdout);
    const video = probe.streams.find(stream => stream.codec_type === "video");
    const audio = probe.streams.find(stream => stream.codec_type === "audio");
    const edge = quality === "4K" ? 2160 : quality === "1080p" ? 1080 : 720;
    assert.deepEqual([video.width, video.height], [edge, Math.round(edge * 16 / 9)]);
    assert.equal(video.codec_name, "h264");
    assert.equal(audio?.codec_name, "aac");
    const duration = Number(probe.format.duration);
    assert.ok(Math.abs(duration - 1) < 0.08, `${quality} duration ${duration} should match the authored 1 second`);
    console.log(`${quality}: ${video.width}x${video.height}, H.264/AAC, ${duration.toFixed(3)}s`);
    await request(`/api/renders/${created.id}`, { method: "DELETE", headers: { Origin: origin, Cookie: cookie } });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
