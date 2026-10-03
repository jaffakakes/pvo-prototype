import { assistantServiceErrorDefinition } from "../../../packages/pvo-assistant/service-errors.js";
import { HttpError } from "../../http.js";

/** Only these curated classifications may be serialized by assistant routes. */
export class NativeAssistantError extends HttpError {
  constructor(code) {
    const definition = assistantServiceErrorDefinition(code);
    if (!definition) throw new TypeError("Unknown assistant failure classification.");
    super(definition.status, definition.message);
    this.code = code;
  }
}
