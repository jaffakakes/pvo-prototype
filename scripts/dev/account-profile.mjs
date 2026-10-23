import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { profileResponse } from "../../server/account/profile.js";
import { HttpError } from "../../server/http.js";
import { json } from "./http.mjs";
import { createLocalOriginPolicy } from "./local-origins.mjs";

export function createLocalProfileApi({
  directory,
  origin,
  publicOrigin,
  userFor,
}) {
  const policy = createLocalOriginPolicy(origin, publicOrigin);
  const root = join(directory, "account-profiles");
  const pathFor = (id) =>
    join(root, `${createHash("sha256").update(id).digest("hex")}.json`);
  return async (request, response) => {
    try {
      const requestOrigin = policy.originFor(request);
      if (!requestOrigin)
        throw new HttpError(400, "This account address is invalid.");
      if (!policy.accepts(request))
        throw new HttpError(403, "This operation must start from the editor.");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 92000)
          throw new HttpError(413, "The profile is too large.");
        chunks.push(chunk);
      }
      const webRequest = new Request(new URL(request.url, requestOrigin), {
        method: request.method,
        headers: request.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const result = await profileResponse(webRequest, {
        origin: requestOrigin,
        user: await userFor(request),
        read: async (id) => {
          try {
            return JSON.parse(await readFile(pathFor(id), "utf8"));
          } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
          }
        },
        write: async (id, profile) => {
          await mkdir(root, { recursive: true, mode: 0o700 });
          const temporary = join(root, `${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, JSON.stringify(profile), {
              flag: "wx",
              mode: 0o600,
            });
            await rename(temporary, pathFor(id));
          } finally {
            await rm(temporary, { force: true });
          }
        },
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch (error) {
      if (!(error instanceof HttpError))
        console.error("Account profile operation failed", error?.name);
      json(response, error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError
            ? error.message
            : "Couldn't save your profile. Try again.",
      });
    }
  };
}
