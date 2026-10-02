import { notificationDefinition, type NotificationId } from "./catalog";

export const BRIEF_NOTIFICATION_MS = 4000;
export const NOTIFICATION_COOLDOWN_MS = 10_000;
export type NotificationOptions = { scope?: string; operation?: string; currentAttempt?: boolean; summary?: string };
export type Notification = { key: string; id: NotificationId; scope: string; operation?: string; createdAt: number;
  summary?: string; action?: "undoAssistantEdit" };
type SeenEvent = { key: string; id: NotificationId; scope: string; at: number };
export type NotificationState = {
  current: Notification | null;
  unresolved: Notification[];
  announcement: Notification | null;
  seen: SeenEvent[];
  lastBriefAt: number | null;
  busy: boolean;
};

export const initialNotifications = (): NotificationState => ({
  current: null, unresolved: [], announcement: null, seen: [], lastBriefAt: null, busy: false,
});

/** No timers, queue, or feature state: display decisions use an explicit timestamp. */
export function receiveNotification(state: NotificationState, id: NotificationId,
  options: NotificationOptions, now: number): NotificationState {
  const definition = notificationDefinition(id);
  const scope = options.scope ?? "app";
  const key = JSON.stringify([id, scope, definition.oncePerScope ? null : options.operation ?? null]);
  const previous = state.seen.find(event => event.key === key);
  if (previous && (definition.oncePerScope || definition.persistent || options.operation !== undefined
    || now - previous.at < NOTIFICATION_COOLDOWN_MS)) return state;
  const actionFeedback = Boolean(definition.action && options.currentAttempt);
  // A new request must reveal its own failure, even when it follows a quick retry.
  const attemptFeedback = Boolean(definition.reportEachAttempt && options.currentAttempt && options.operation);
  if (!definition.persistent && ((state.busy && !options.currentAttempt)
    || (state.lastBriefAt !== null && now - state.lastBriefAt < NOTIFICATION_COOLDOWN_MS
      && !actionFeedback && !attemptFeedback))) return state;

  const summary = definition.action && typeof options.summary === "string" && options.summary.trim().length <= 50
    ? options.summary.trim() : undefined;
  const notification: Notification = { key, id, scope, operation: options.operation, createdAt: now,
    ...(definition.action ? { action: definition.action } : {}), ...(summary ? { summary } : {}) };
  const unresolved = definition.persistent ? [...state.unresolved, notification] : state.unresolved;
  const seen = [...state.seen.filter(event => event.key !== key), { key, id, scope, at: now }];
  // A second durable failure stays reachable in the registry; it never displaces the first.
  if (state.current && notificationDefinition(state.current.id).persistent)
    return definition.persistent ? { ...state, unresolved, seen } : state;
  return {
    ...state, current: notification, unresolved, seen, announcement: notification,
    lastBriefAt: definition.persistent || actionFeedback ? state.lastBriefAt : now,
  };
}

export function dismissCurrentNotification(state: NotificationState): NotificationState {
  return { ...state, current: null, announcement: null };
}

function removeMatching(state: NotificationState, matches: (entry: { id: NotificationId; scope: string }) => boolean): NotificationState {
  return {
    ...state,
    current: state.current && matches(state.current) ? null : state.current,
    announcement: state.announcement && matches(state.announcement) ? null : state.announcement,
    unresolved: state.unresolved.filter(entry => !matches(entry)),
    seen: state.seen.filter(entry => !matches(entry)),
  };
}

export function resolveNotificationEvent(state: NotificationState, id: NotificationId, scope?: string): NotificationState {
  return removeMatching(state, entry => entry.id === id && (scope === undefined || entry.scope === scope));
}

export function removeNotificationScope(state: NotificationState, scope: string): NotificationState {
  return removeMatching(state, entry => entry.scope === scope);
}
