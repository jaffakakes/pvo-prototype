import { manualFieldLabel } from "./manual.js";
import { requireTask } from "./validation.js";

/** Check the actual compiled controls, not model assurances or source substrings. */
export function validateManualComponent(task, compiled, binding) {
  if (!task.manualPlans.length) return;
  const structure = compiled.structure;
  const used = new Set();
  const visit = (value) => {
    if (value.kind === "field") used.add(value.name);
    if (value.kind === "object")
      value.fields.forEach((field) => visit(field.value));
    if (value.kind === "array") value.items.forEach(visit);
  };
  visit(binding);
  for (const plan of task.manualPlans) {
    const visible =
      structure.type === "form"
        ? structure.heading
        : structure.type === "card"
          ? structure.body
          : structure.prompt;
    requireTask(
      typeof visible === "string" && visible.includes(plan.proposal.notice),
      "Include the agreed pending-action notice in the visible component heading, card body or choice prompt.",
    );
    for (const field of plan.proposal.fields) {
      const actual =
        structure.type === "form" &&
        structure.fields.find((item) => item.name === field.name);
      requireTask(
        actual &&
          actual.kind === field.kind &&
          actual.label === manualFieldLabel(field),
        "Preserve agreed fields, types and visible data purposes. Field labels must use label + ' — ' + purpose.",
      );
      requireTask(
        used.has(field.name),
        "Send each agreed field through the existing checked operation binding.",
      );
    }
  }
}
