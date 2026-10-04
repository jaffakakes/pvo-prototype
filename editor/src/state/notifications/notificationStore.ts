import { create } from "zustand";
import type { NotificationId } from "../../domain/notifications/catalog";
import {
  dismissCurrentNotification, initialNotifications, receiveNotification, removeNotificationScope,
  resolveNotificationEvent, type NotificationOptions, type NotificationState,
} from "../../domain/notifications/policy";

export type { NotificationId } from "../../domain/notifications/catalog";

function restoreNoticeKey(): string | null {
  if (typeof window === "undefined") return null;
  const project = new URL(window.location.href).searchParams.get("project") ?? "current";
  return `restyle:restore-notice-ack:${project}`;
}

function readRestoreAcknowledgement(): boolean {
  try {
    const key = restoreNoticeKey();
    return key !== null && localStorage.getItem(key) === "1";
  } catch { return false; }
}

function writeRestoreAcknowledgement(acknowledged: boolean): void {
  try {
    const key = restoreNoticeKey();
    if (key === null) return;
    if (acknowledged) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch { /* Browser preferences are optional; in-memory dismissal still works. */ }
}

export const useNotifications = create<NotificationState>(() => initialNotifications(readRestoreAcknowledgement()));

export function notify(id: NotificationId, options: NotificationOptions = {}): void {
  useNotifications.setState(state => receiveNotification(state, id, options, Date.now()));
}
export function resolveNotification(id: NotificationId, scope?: string): void {
  useNotifications.setState(state => resolveNotificationEvent(state, id, scope));
  if (id === "restoreFailed") writeRestoreAcknowledgement(false);
}
export function clearNotificationScope(scope: string): void {
  const clearsRestore = useNotifications.getState().unresolved.some(issue => issue.id === "restoreFailed" && issue.scope === scope);
  useNotifications.setState(state => removeNotificationScope(state, scope));
  if (clearsRestore) writeRestoreAcknowledgement(false);
}
export function dismissNotification(): void {
  const dismissingRestore = useNotifications.getState().current?.id === "restoreFailed";
  useNotifications.setState(dismissCurrentNotification);
  if (dismissingRestore) writeRestoreAcknowledgement(true);
}
export function showNotificationIssue(key: string): void {
  const state = useNotifications.getState();
  const issue = state.unresolved.find(entry => entry.key === key);
  if (issue?.id === "restoreFailed" && state.restoreAcknowledged) return;
  if (issue) useNotifications.setState({ current: issue });
}
export function setNotificationsBusy(busy: boolean): void {
  if (useNotifications.getState().busy !== busy) useNotifications.setState({ busy });
}
export function resetNotifications(): void {
  useNotifications.setState(initialNotifications());
  writeRestoreAcknowledgement(false);
}
