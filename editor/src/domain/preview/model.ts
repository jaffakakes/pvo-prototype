import type { ComponentResponse } from "../project/model";

export type TryMode = {
  playing: boolean;
  /** Interactive component waiting at the end of its layer for a response. */
  holdingId: string | null;
  /** Components whose response boundary has already been processed in this scene. */
  handled: string[];
  /** Responses captured locally; layer-end responses have not reached Logic yet. */
  capturedResponses: Record<string, ComponentResponse>;
  /** Responses already handed to Logic, used to prevent duplicate requests. */
  dispatched: string[];
};
