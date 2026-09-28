import { useEffect, useRef } from "react";
import { notificationDefinition } from "../../domain/notifications/catalog";
import { BRIEF_NOTIFICATION_MS, type Notification } from "../../domain/notifications/policy";
import { dismissNotification, useNotifications } from "../../state/notifications/notificationStore";

export function useNotificationTimeout(notification: Notification | null, paused: boolean) {
  const clock = useRef({ key: "", createdAt: 0, remaining: BRIEF_NOTIFICATION_MS });
  useEffect(() => {
    if (!notification || notificationDefinition(notification.id).persistent) return;
    const { key, createdAt } = notification;
    if (clock.current.key !== key || clock.current.createdAt !== createdAt)
      clock.current = { key, createdAt, remaining: BRIEF_NOTIFICATION_MS };
    if (paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => {
      if (useNotifications.getState().current === notification) dismissNotification();
    }, clock.current.remaining);
    return () => {
      window.clearTimeout(timer);
      clock.current.remaining = Math.max(0, clock.current.remaining - (performance.now() - start));
    };
  }, [notification, paused]);
}
