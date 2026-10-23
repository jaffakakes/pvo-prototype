import type { JsonValue, PvoAction, PvoFormField } from "../index.js";
export type FieldKind =
  "name" | "email" | "phone" | "short" | "number" | "yesno";
export const FORM_FIELD_LABELS: Readonly<Record<FieldKind, string>>;
export function formFieldDefinition(field: {
  name: string;
  kind: FieldKind;
  label?: string;
}): PvoFormField;
export function requestHost(raw: string): string;
export function requestBody(source: string): JsonValue | undefined;
type PlaybackOutcome =
  | { kind: "continue" }
  | { kind: "time"; t: number }
  | { kind: "scene"; sceneId: string };
export type LanguageOutcome =
  | PlaybackOutcome
  | {
      kind: "request";
      url: string;
      method: "GET" | "POST";
      body: string;
      onSuccess: PlaybackOutcome;
      onError: PlaybackOutcome | null;
    };
export function actionForOutcome(
  outcome: LanguageOutcome | undefined,
  componentId?: string,
): PvoAction;
