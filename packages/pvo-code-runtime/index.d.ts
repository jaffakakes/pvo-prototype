import type { AppliedFont } from "../pvo-fonts/index.js";
export type PvoCodeAction = {
  method: "pick" | "goToScene" | "jumpTo" | "resume" | "track" | "submit" | "request";
  args: unknown[];
};

/** Bounded bridge facts; the host supplies run/scene identity and safe error presentation. */
export type PvoCodeDiagnostic = {
  type: "component.ready" | "component.failed" | "component.unavailable" | "component.inactive" | "interaction.received" | "interaction.ignored" | "action.started" | "action.completed";
  componentId?: string;
  eventId?: number;
  reason?: string;
  phase?: "renderer" | "worker" | "bridge";
  target?: string;
};

export type PvoCodeOptions = {
  html: string;
  css: string;
  js: string;
  fields?: Record<string, unknown>;
  /** Runtime state for escaped `{state.path}` presentation templates. Omit to show authored tokens literally. */
  state?: Record<string, unknown>;
  componentId?: string;
  /** Host-validated embedded font data, independent of authored Style. */
  font?: AppliedFont;
  /** Maximum CSS-pixel dimensions of the sandboxed renderer. Defaults to 247×600. */
  maxWidth?: number;
  maxHeight?: number;
  /** Scale measured 247px-baseline content while preserving layout size. Defaults to 1. */
  scale?: number;
  /** Set false while an editor drag layer should own pointer events. */
  interactive?: boolean;
  /** Host request status; temporarily disables form controls and shows its waiting label. */
  pending?: boolean;
  /** Host must validate actions against current PVO state. For request, return the parsed response or reject. */
  onAction?: (action: PvoCodeAction, diagnostic?: { eventId: number }) => unknown | Promise<unknown>;
  onError?: (message: string) => void;
  /** Optional observation only. Throwing cannot interrupt the component. */
  onDiagnostic?: (event: PvoCodeDiagnostic) => void;
};

export type PvoCodeHandle = {
  update(next: Partial<PvoCodeOptions>): void;
  setInteractive(value: boolean): void;
  setPending(value: boolean): void;
  destroy(): void;
};

export function substituteFieldTokens(html: string, fields?: Record<string, unknown>): string;
export function mountCustomComponent(container: Element, options: PvoCodeOptions): PvoCodeHandle;
