import type { CompiledPvoComponent, PvoLanguageDiagnostic } from "../pvo-language/index.js";
import type { AssistantContext } from "./index.js";

export class AssistantPolicyError extends Error {
  code: string;
  part?: "structure" | "style" | "logic";
  diagnostic?: PvoLanguageDiagnostic;
  constructor(code: string, message: string, details?: {
    part?: "structure" | "style" | "logic";
    diagnostic?: PvoLanguageDiagnostic;
  });
}

export function validateCompiledAssistantOriginal(compiled: CompiledPvoComponent, context?: AssistantContext): void;
export function usesTypedFormValues(structure: Extract<CompiledPvoComponent["structure"], { type: "form" }>): boolean;
export function validateCompiledAssistantProposal(
  original: CompiledPvoComponent,
  proposed: CompiledPvoComponent,
  context?: AssistantContext,
): void;
