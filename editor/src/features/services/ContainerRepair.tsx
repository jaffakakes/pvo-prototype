import {useEffect,useState} from "react";
import type {TaskRecord} from "../../../../packages/pvo-assistant/tasks/index.js";
import type {RepairReport} from "../../../../packages/pvo-assistant/maintenance/index.js";
import {readContainerRepair} from "../../infrastructure/services/maintenance";
import {useAuthGate} from "../../state/auth/authGateStore";
export function ContainerRepair({task}:{task:TaskRecord}) {
  const [report,setReport]=useState<RepairReport|null>(null),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const current=()=>!controller.signal.aborted&&useAuthGate.getState().user?.id===task.ownerId;
    void readContainerRepair(task,controller.signal).then(value=>{if(current()){setReport(value);setError(null)}},failure=>{if(current())setError(failure.message)});
    return()=>controller.abort();
  },[task.id,task.revision,task.ownerId,attempt]);
  if(useAuthGate.getState().user?.id!==task.ownerId)return null;
  return <section aria-label="Saved investigation"><h4>Investigation</h4>
    {error && <p role="alert">{error} <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry investigation</button></p>}
    {report ? <><p>{report.summary}</p><p>Initial checks: {report.baseline}. {report.outcome}</p>{report.dependencies.map((item,index)=><p key={index}>{item.message} {item.recovery}</p>)}</> : !error && <p role="status">Preparing safe checks…</p>}
  </section>;
}
