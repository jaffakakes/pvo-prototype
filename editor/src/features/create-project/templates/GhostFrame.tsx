import type { ProjectTemplate } from "../../../domain/project/templates";
import { CaptionHint } from "./hints/CaptionHint";
import { CardHint } from "./hints/CardHint";
import { ChoiceHint } from "./hints/ChoiceHint";
import { FormHint } from "./hints/FormHint";
import { JumpHint } from "./hints/JumpHint";
import { RouteHint } from "./hints/RouteHint";
import styles from "./GhostFrame.module.css";

function Hint({ hint }: Pick<ProjectTemplate, "hint">) {
  if (hint === "caption") return <CaptionHint />;
  if (hint === "card") return <CardHint />;
  if (hint === "choice") return <ChoiceHint />;
  if (hint === "route") return <RouteHint />;
  if (hint === "jump") return <JumpHint />;
  return <FormHint />;
}

export function GhostFrame({ template }: { template: ProjectTemplate }) {
  return <span
    className={styles.ghost}
    data-template-preview={template.id}
    data-ratio={template.ratio}
    data-hint={template.hint}
    aria-hidden="true"
  >
    <Hint hint={template.hint} />
  </span>;
}
