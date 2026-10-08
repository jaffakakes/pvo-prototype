import {
  parseConnectionSetup,
  parseConnectionInvocation,
} from "../../packages/pvo-assistant/connections/index.js";
import {
  object,
  id,
  integer,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { HttpError } from "../http.js";

/** Private form fields are validated here and never copied into tasks or model inputs. */
export function connectionCommand(kind, value) {
  try {
    if (kind === "list") {
      object(value, ["after"], "Connection list");
      if (value.after !== null) id(value.after, "Cursor");
    } else if (kind === "connect") {
      object(
        value,
        ["id", "expectedRevision", "setup", "token"],
        "Private setup",
      );
      id(value.id, "Connection ID");
      integer(
        value.expectedRevision,
        Number.MAX_SAFE_INTEGER,
        "Connection revision",
      );
      value = { ...value, setup: parseConnectionSetup(value.setup) };
      if (
        typeof value.token !== "string" ||
        !/^github_pat_[A-Za-z0-9_]{20,245}$/.test(value.token)
      )
        throw new Error("Fine-grained token required");
    } else if (kind === "attach") {
      object(
        value,
        ["id", "taskId", "questionId", "expectedRevision", "operationId"],
        "Task connection",
      );
      for (const key of ["id", "taskId", "questionId", "operationId"])
        id(value[key], key);
      integer(value.expectedRevision, Number.MAX_SAFE_INTEGER, "Task revision");
    } else if (kind === "invoke") {
      object(value, ["id", "call"], "Connection invocation");
      id(value.id, "Connection ID");
      parseConnectionInvocation(value.call);
    } else if (["check", "disconnect"].includes(kind)) {
      object(value, ["id", "expectedRevision"], "Connection control");
      id(value.id, "Connection ID");
      integer(
        value.expectedRevision,
        Number.MAX_SAFE_INTEGER,
        "Connection revision",
        1,
      );
    } else throw new Error("Unsupported operation");
    return structuredClone(value);
  } catch {
    throw new HttpError(
      400,
      "This connection request is invalid. Check the repository and private setup fields.",
    );
  }
}
