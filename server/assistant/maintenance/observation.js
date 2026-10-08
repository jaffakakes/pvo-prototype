import { draftHost, consumeDraftRpc } from "../drafts/creation.js";
import { runDraftTestPreparation } from "../drafts/testing.js";
import { hasCurrentClaim, taskClaim, transitionGuard } from "../tasks/executionClaim.js";

/** Read current owned health; lifecycle changes invalidate an in-progress repair rather than retarget it. */
export async function refreshRepairObservation(coordinator, task) {
  if (task.input.context.container?.mode !== "repair") return;
  const state = coordinator.drafts.get(task.id);
  const result = await consumeDraftRpc(draftHost(coordinator,state.draft.identity.serviceId).maintenance(state.draft.identity.serviceId,task.ownerId));
  if (!result.ok) throw new Error("Container health could not be checked.");
  if (state.maintenance && result.value.serviceRevision !== state.maintenance.snapshot.serviceRevision) throw new Error("Container version changed. Start a fresh investigation.");
  await coordinator.transaction(()=>{
    if (!hasCurrentClaim(coordinator.attempts.task(task.id),task,coordinator.now())) throw new Error("Repair claim ended.");
    state.maintenance ??= {phase:"baseline",snapshot:result.value,baseline:null,diagnosis:null,verifiedRevision:null,agreement:state.draft.content.agreement,tests:state.draft.content.files.filter(file=>state.draft.content.tests.includes(file.path))};
    state.maintenance.snapshot=result.value;
    coordinator.drafts.write(task.id,state);
  });
}
export async function runInitialRepairBaseline(coordinator, claimed) {
  try { await refreshRepairObservation(coordinator,claimed); await runDraftTestPreparation(coordinator,claimed); }
  catch { await coordinator.transaction(()=>{
    const task=coordinator.attempts.task(claimed.id);
    if(hasCurrentClaim(task,claimed,coordinator.now()))coordinator.repository.update(task.id,{kind:"fail",failure:{code:"execution_failed",stepId:task.stepId}},transitionGuard(task,coordinator.now(),taskClaim(task)));
  }); }
}
