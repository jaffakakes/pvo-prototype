export type AssistantServiceErrorCode = "provider_allowance_exhausted"
  | "model_output_invalid" | "model_output_truncated" | "edit_validation_failed";

export function assistantServiceErrorDefinition(code: unknown, status?: number): {
  code: AssistantServiceErrorCode;
  status: number;
  message: string;
} | null;
