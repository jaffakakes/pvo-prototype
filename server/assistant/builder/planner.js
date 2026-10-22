import { generateAuthoringResponse } from "../tasks/modelResponse.js";
import { connectionSetupAvailable } from "../../connections/credentials.js";
import { AuthoringRepairError } from "../tasks/repairFeedback.js";
import { builderInstructions } from "./prompt.js";
import { authoringMessages } from "../tasks/promptContext.js";
import {
  evidenceInstructions,
  withEvidenceSchema,
  parseEvidenceRequest,
} from "../tasks/evidenceInput.js";
import { nativeModels } from "../native/models.js";
import {
  builderModelTools,
  builderModelSchema,
  builderModelDecision,
  bindBuilderModelDecision,
} from "./modelInput.js";
import {
  BUILDER_LIMITS,
  BUILDER_RESEARCH_KINDS,
} from "../../../packages/pvo-assistant/builder/index.js";

/** One inference only. The durable runner owns claims, budgets and saving the validated decision. */
export async function planSavedBuild(
  task,
  context,
  definitions,
  env,
  signal,
  evidence = null,
  models = nativeModels(env),
) {
  const hasAgreement = context.agreement !== null;
  // Capture before inference: a concurrent edit must never retarget this decision.
  const source = structuredClone(context.source);
  const modelTools = builderModelTools(definitions);
  const privateAccountSetupAvailable = connectionSetupAvailable(env);
  if (
    new TextEncoder().encode(JSON.stringify(context.feedback ?? [])).length >
    BUILDER_LIMITS.feedbackBytes
  )
    throw Object.assign(new Error("Saved feedback violates its bound."), {
      code: "invalid_result",
    });
  const messages = authoringMessages(
    builderInstructions(
      hasAgreement,
      definitions.some((tool) => BUILDER_RESEARCH_KINDS.includes(tool.kind)),
    ) +
      "\n" +
      evidenceInstructions,
    {
      input: task.input,
      questions: task.questions,
      privateAccountSetupAvailable,
      evidence,
      build: {
        ...context,
        lastDecision: builderModelDecision(context.lastDecision),
      },
      tools: modelTools
        .filter(
          (tool) => hasAgreement || BUILDER_RESEARCH_KINDS.includes(tool.kind),
        )
        .map(({ kind, description, schema }) => ({
          kind,
          description,
          schema,
        })),
    },
    BUILDER_LIMITS.promptBytes,
  );
  const response = await generateAuthoringResponse(
    models,
    {
      messages,
      schema: withEvidenceSchema(
        builderModelSchema(
          hasAgreement,
          modelTools,
          privateAccountSetupAvailable,
        ),
      ),
      maxTokens: hasAgreement ? 6000 : 12000,
      temperature: 0.2,
    },
    signal,
  );
  try {
    if (
      !response ||
      typeof response !== "object" ||
      (response.toolCalls !== undefined &&
        (!Array.isArray(response.toolCalls) || response.toolCalls.length))
    )
      throw new Error("Unsupported provider tool calls.");
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    if (
      typeof content !== "string" ||
      new TextEncoder().encode(content).length > BUILDER_LIMITS.decisionBytes
    )
      throw new Error("Builder response exceeds its bound.");
    const decision = JSON.parse(content);
    if (decision?.kind === "history") return parseEvidenceRequest(decision);
    return bindBuilderModelDecision(
      decision,
      source,
      {
        hasAgreement,
        connectionSetup: privateAccountSetupAvailable,
        available: definitions.map((tool) => tool.kind),
      },
      modelTools,
    );
  } catch (error) {
    throw new AuthoringRepairError(
      "builder_response",
      `Repair the rejected builder decision using the supplied JSON schema. Local validation: ${error instanceof Error ? error.message : "Invalid builder decision."}`,
      response?.content,
    );
  }
}
