import { create } from "zustand";
import type { NotificationId } from "../../domain/notifications/catalog";
import {
  dismissCurrentNotification, initialNotifications, receiveNotification, removeNotificationScope,
  resolveNotificationEvent, type NotificationOptions, type NotificationState,
} from "../../domain/notifications/policy";

export type { NotificationId } from "../../domain/notifications/catalog";
export const useNotifications = create<NotificationState>(() => initialNotifications());

export function notify(id: NotificationId, options: NotificationOptions = {}): void {
  useNotifications.setState(state => receiveNotification(state, id, options, Date.now()));
}
export function resolveNotification(id: NotificationId, scope?: string): void {
  useNotifications.setState(state => resolveNotificationEvent(state, id, scope));
}
export function clearNotificationScope(scope: string): void {
  useNotifications.setState(state => removeNotificationScope(state, scope));
}
export function dismissNotification(): void {
  useNotifications.setState(dismissCurrentNotification);
}
export function showNotificationIssue(key: string): void {
  const issue = useNotifications.getState().unresolved.find(entry => entry.key === key);
  if (issue) useNotifications.setState({ current: issue });
}
export function setNotificationsBusy(busy: boolean): void {
  if (useNotifications.getState().busy !== busy) useNotifications.setState({ busy });
}
export function resetNotifications(): void {
  useNotifications.setState(initialNotifications());
}
