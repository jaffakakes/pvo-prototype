import { parseMaintenanceSnapshot, parseRepairReport } from "../../../../packages/pvo-assistant/maintenance/index.js";
import type {TaskRecord} from "../../../../packages/pvo-assistant/tasks/index.js";
export async function readContainerHealth(serviceId:string, ownerId:string, signal:AbortSignal) {
  const response = await fetch(`/api/services/${serviceId}/maintenance`, {credentials:"same-origin",signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if (!response.ok) throw new Error("Couldn’t check this Container. Refresh its health to try again.");
  return parseMaintenanceSnapshot(await response.json(), ownerId, serviceId);
}
export async function readContainerRepair(task:TaskRecord, signal:AbortSignal) {
  const response=await fetch(`/api/assistant/tasks/${task.id}/tests`,{credentials:"same-origin",signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if(!response.ok)throw new Error("Couldn’t load the investigation. Retry to check its saved result.");
  return parseRepairReport((await response.json()).repair);
}
