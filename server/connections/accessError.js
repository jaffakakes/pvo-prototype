import { HttpError } from "../http.js";
export class ConnectionAccessError extends HttpError {
  constructor() {
    super(
      409,
      "Account access has expired or changed. Reconnect this account.",
    );
  }
}
