import { failure, json } from "../http.mjs";
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCES,
  readRenderJson,
  validateJobInput,
} from "./input.mjs";
import { createLocalRenderJobs, publicJob } from "./jobs.mjs";
import { downloadResult, uploadSource } from "./transfers.mjs";

const JOB_ID = /^[a-f0-9]{32}$/;

/** Loopback HTTP adapter. Account ownership is checked before any private job operation. */
export async function createLocalRenderApi({ userFor } = {}) {
  if (typeof userFor !== "function")
    throw new Error("Local rendering requires account session lookup.");
  const jobs = await createLocalRenderJobs();

  async function handle(request, response, pathname, origin) {
    if (!pathname.startsWith("/api/renders")) return false;
    if (pathname === "/api/renders" && request.method === "GET")
      return json(response, 200, {
        available: true,
        maxSourceBytes: MAX_SOURCE_BYTES,
        maxSources: MAX_SOURCES,
        formats: ["video"],
        qualities: ["720p", "1080p", "4K"],
      });
    if (request.method !== "GET" && request.headers.origin !== origin)
      return failure(response, 403, "This request must come from the editor.");
    const user = await userFor(request);
    if (!user?.id)
      return failure(response, 401, "Sign in to render this export.");
    if (pathname === "/api/renders" && request.method === "POST") {
      let input;
      try {
        input = validateJobInput(await readRenderJson(request));
      } catch (error) {
        return failure(
          response,
          422,
          error instanceof Error
            ? error.message
            : "The render description is invalid.",
        );
      }
      return json(response, 201, publicJob(await jobs.create(user.id, input)));
    }
    const match =
      /^\/api\/renders\/([^/]+)(?:\/(sources\/([^/]+)|start|result))?$/.exec(
        pathname,
      );
    if (!match || !JOB_ID.test(match[1]))
      return failure(response, 404, "This render is unavailable.");
    const job = jobs.get(match[1]);
    if (!job || job.owner !== user.id)
      return failure(response, 404, "This render is unavailable.");
    if (!match[2] && request.method === "GET")
      return json(response, 200, publicJob(job));
    if (match[2] === "result" && request.method === "GET")
      return downloadResult(response, job);
    if (match[2] === "start" && request.method === "POST") {
      if (!jobs.start(job))
        return failure(
          response,
          409,
          "Upload all source files before rendering.",
        );
      return json(response, 202, publicJob(job));
    }
    if (match[2]?.startsWith("sources/") && request.method === "PUT")
      return uploadSource(request, response, job, match[3], jobs.remove);
    if (!match[2] && request.method === "DELETE") {
      await jobs.cancel(job);
      return json(response, 200, { cancelled: true });
    }
    return failure(response, 405, "This render operation is not supported.");
  }

  return { handle, close: jobs.close };
}
