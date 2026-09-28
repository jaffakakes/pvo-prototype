import type { CompiledPvoComponent } from "../pvo-language/index.js";
export function validateNoCodeAssistantProposal(
  original: Pick<CompiledPvoComponent, "rules">,
  proposed: Pick<CompiledPvoComponent, "rules">,
): void;
