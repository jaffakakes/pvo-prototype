import { parseServiceControl } from "../../../../packages/pvo-assistant/hosting/index.js";
import { readService, sendControl, type PendingControl } from "./client";

const key = (ownerId: string, serviceId: string) =>
  `restyle:export-activation:${ownerId}:${serviceId}`;

/** One unresolved activation per owned service; unrelated exports cannot overwrite its intent. */
export const exportActivationAdapters = {
  read: readService,
  send: sendControl,
  pending(ownerId: string, serviceId: string): PendingControl | null {
    const encoded = localStorage.getItem(key(ownerId, serviceId));
    if (encoded === null) return null;
    const value = JSON.parse(encoded) as PendingControl;
    if (value.serviceId !== serviceId)
      throw new Error("The saved activation could not be read.");
    return { serviceId, control: parseServiceControl(value.control) };
  },
  save(ownerId: string, serviceId: string, value: PendingControl | null) {
    if (value)
      localStorage.setItem(key(ownerId, serviceId), JSON.stringify(value));
    else localStorage.removeItem(key(ownerId, serviceId));
  },
  createId: () => crypto.randomUUID(),
  now: () => Date.now(),
};
