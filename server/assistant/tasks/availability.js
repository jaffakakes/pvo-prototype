import { getAccountSession } from "../../auth/sessions.js";
import { savedPlannerAvailable } from "./planner.js";

export function taskStorageAvailable(env, config, origin) {
  return Boolean(
    config.origin &&
    config.origin === origin &&
    env.DB &&
    env.SESSION_SECRET &&
    typeof env.ASSISTANT_TASKS?.getByName === "function",
  );
}

/** A client header opts into the contract; only the signed session grants access. */
export async function savedTaskPlanningAvailable(request, env, config) {
  if (
    !taskStorageAvailable(env, config, new URL(request.url).origin) ||
    !savedPlannerAvailable(env)
  )
    return false;
  return Boolean(await getAccountSession(request, env));
}
