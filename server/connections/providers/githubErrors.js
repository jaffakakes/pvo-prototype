import { HttpError } from "../../http.js";
export class GitHubAccessError extends HttpError {
  constructor() {
    super(
      409,
      "GitHub access has expired or changed. Reconnect this repository.",
    );
  }
}
