import {useEffect,useState} from "react";
import type {MaintenanceSnapshot} from "../../../../packages/pvo-assistant/maintenance/index.js";
import {readContainerHealth} from "../../infrastructure/services/maintenance";
import {useAuthGate} from "../../state/auth/authGateStore";
export function ContainerHealth({ownerId,serviceId,revision}:{ownerId:string;serviceId:string;revision:number}) {
  const [report,setReport]=useState<MaintenanceSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const current=()=>!controller.signal.aborted && useAuthGate.getState().user?.id===ownerId;
    setError(null);
    void readContainerHealth(serviceId,ownerId,controller.signal).then(value=>{if(current())setReport(value)},failure=>{if(current())setError(failure.message)});
    return()=>controller.abort();
  },[ownerId,serviceId,revision,attempt]);
  if(useAuthGate.getState().user?.id!==ownerId)return null;
  return <details><summary>Container health{report?.issues.length ? ` · ${report.issues.length} need attention` : ""}</summary>
    {error && <p role="alert">{error}</p>}
    {!report && !error && <p role="status">Checking account access, saved work and component links…</p>}
    {report && <><p>Checked {new Date(report.observedAt).toLocaleString()}. Refresh for current status.</p>{!report.issues.length ? <p>No operational problem was found in this check. This does not test every possible viewer interaction.</p> : <ul>{report.issues.map(issue=><li key={issue.key}><p>{issue.message}</p><p>{issue.recovery}</p></li>)}</ul>}</>}
    <button type="button" onClick={()=>setAttempt(value=>value+1)}>Refresh health</button>
  </details>;
}
