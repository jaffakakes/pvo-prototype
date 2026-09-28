export type PvoLanguageSource = {
  structure: string;
  style: string;
  logic: string;
};

export type PvoLanguageDiagnostic = {
  code: string;
  message: string;
  line: number;
  column: number;
};

export type PvoLanguageStructure =
  | { type: "tooltip"; text: string }
  | { type: "card"; title: string | null; body: string | null; buttons: Array<{ id: string; label: string }> }
  | { type: "choice"; prompt: string; options: Array<{ id: string; label: string }> }
  | { type: "form"; heading?: string; fields: Array<{ name: string; kind: "name" | "email" | "phone" | "short" | "number" | "yesno"; label?: string }>; submit: string; waiting?: string };

export type PvoLanguageRule = {
  event: "press" | "choose" | "submit";
  target: string | null;
  action:
    | { kind: "continue" }
    | { kind: "time"; t: number }
    | { kind: "scene"; sceneId: string }
    | {
      kind: "request";
      url: string;
      method: "GET" | "POST";
      body: string;
      onSuccess: { kind: "continue" } | { kind: "time"; t: number } | { kind: "scene"; sceneId: string };
      onError: { kind: "continue" } | { kind: "time"; t: number } | { kind: "scene"; sceneId: string } | null;
    };
};

export type CompiledPvoComponent = {
  structure: PvoLanguageStructure;
  rules: PvoLanguageRule[];
  html: string;
  css: string;
  js: string;
};

export class PvoLanguageError extends Error {
  part: "structure" | "style" | "logic";
  diagnostic: PvoLanguageDiagnostic;
}

export function compilePvoComponent(
  kind: "tooltip" | "card" | "choice" | "form",
  source: PvoLanguageSource,
): Promise<CompiledPvoComponent>;

export function isPvoLanguageActionAllowed(kind: string, method: string): boolean;
