import { useRef,useState } from "react";
import { useWideLayout } from "../../../infrastructure/viewport";
import { fieldsShownFor } from "../../../domain/components/fields";
import { requestBody,requestHost } from "../../../domain/components/actions";
import type { Outcome,OutcomeTarget,PlaybackOutcome,PvoComponent } from "../../../domain/project/model";
import { clamp } from "../../../domain/project/numbers";
import { useCapture } from "../../../state/captureStore";
import { createRoutedScene } from "../../../state/scenes/sceneRoutingCommands";
import { cx } from "../../../styles";
import { Icon } from "../../../ui/Icon";
import { beginPlayheadPick } from "../../timeline/playheadPick";
import { SheetFrame } from "../SheetFrame";
import { PlaybackRouteRows } from "./PlaybackRouteRows";
import requestStyles from "./RequestOutcome.module.css";
import { outcomeName } from "./outcomeName";

export function OutcomeStep({ component, target, onBack }: { component: PvoComponent; target: OutcomeTarget; onBack: () => void }) {
  const wide = useWideLayout();
  const s = useCapture();
  const [requestBranch, setRequestBranch] = useState<"success" | "error" | null>(null);
  const groupedRequestEdit = useRef(false);
  const fields = fieldsShownFor(component);
  const selected = target.kind === "option" ? fields.options?.[target.index ?? 0]?.outcome : target.kind === "button" ? fields.buttons?.[target.index ?? 0]?.outcome : fields.outcome;
  const scene = s.scenes.find(item => item.id === component.sceneId);
  const label = target.kind === "option" ? fields.options?.[target.index ?? 0]?.label : target.kind === "button" ? fields.buttons?.[target.index ?? 0]?.label : fields.submitLabel;
  const others = s.scenes.filter(item => item.id !== component.sceneId);
  const pick = (outcome: Outcome, undoable = true) => s.updateOutcome(component.id, target, outcome, undoable);
  const playheadTime = () => clamp(s.t, 0, scene ? Math.max(0, scene.clips.reduce((n, clip) => n + (clip.out - clip.in) / clip.speed, 0)) : 0);
  const request = selected?.kind === "request" ? selected : null;
  const requestDefault: Extract<Outcome, { kind: "request" }> = { kind: "request", url: "", method: "GET", body: "", onSuccess: { kind: "continue" }, onError: null };
  const changeRequest = (changes: Partial<Extract<Outcome, { kind: "request" }>>) => {
    if (!request) return;
    pick({ ...request, ...changes }, !groupedRequestEdit.current);
    groupedRequestEdit.current = true;
  };
  if (requestBranch && request) {
    const route = requestBranch === "success" ? request.onSuccess : request.onError;
    const update = (value: PlaybackOutcome | null, undoable = true) => pick(requestBranch === "success"
      ? { ...request, onSuccess: value ?? { kind: "continue" } }
      : { ...request, onError: value }, undoable);
    return <SheetFrame title={requestBranch === "success" ? "When it succeeds" : "When it fails"} sub={requestBranch === "success" ? "Runs only after a successful response" : "Offline and failed requests never take the success path"} onBack={() => setRequestBranch(null)}>
      <PlaybackRouteRows key={requestBranch} selected={route} pick={update} scene={scene} others={others} playheadTime={playheadTime} onUsePlayhead={() => beginPlayheadPick({ kind: "outcome-time", componentId: component.id, target, branch: requestBranch })} onNewScene={() => createRoutedScene(component.id, target, requestBranch, { openCamera: !wide })} allowNoAction={requestBranch === "error"} />
    </SheetFrame>;
  }
  const urlError = request?.url.trim() ? (() => { try { requestHost(request.url); return null; } catch (error) { return (error as Error).message; } })() : null;
  const bodyError = request?.method === "POST" && request.body.trim() ? (() => { try { requestBody(request.body); return null; } catch (error) { return (error as Error).message; } })() : null;
  return <SheetFrame title={`${label || "Outcome"} → where?`} sub={target.kind === "form" ? "What happens after the viewer submits" : "What happens after the viewer picks this"} onBack={onBack}>
    <PlaybackRouteRows selected={selected && selected.kind !== "request" ? selected : null} pick={value => pick(value ?? { kind: "continue" })} scene={scene} others={others} playheadTime={playheadTime} onUsePlayhead={() => beginPlayheadPick({ kind: "outcome-time", componentId: component.id, target, branch: null })} onNewScene={() => createRoutedScene(component.id, target, undefined, { openCamera: !wide })} />
    <button className={cx("outcomeRow")} data-on={!!request} onClick={() => { if (!request) { pick(requestDefault); groupedRequestEdit.current = true; } }}><i>{request && <Icon name="check" size={13} />}</i><span><strong>Send request</strong><small>Only follow the success route when the server responds</small></span></button>
    {request && <div className={requestStyles.config}>
      <label>Request URL<input className={cx("componentInput")} type="url" aria-label="Request URL" placeholder="https://api.example.com/submit" value={request.url} onChange={event => changeRequest({ url: event.target.value })} /></label>
      <div className={requestStyles.methods} aria-label="Request method">{(["GET", "POST"] as const).map(method => <button key={method} type="button" data-on={request.method === method} onClick={() => changeRequest({ method })}>{method}</button>)}</div>
      {request.method === "POST" && <label>JSON body<textarea className={cx("componentTextArea")} aria-label="Request JSON body" spellCheck={false} placeholder={'{"name":"{state.form.component-1.name_0}"}'} value={request.body} onChange={event => changeRequest({ body: event.target.value })} /></label>}
      <p className={requestStyles.note}>{urlError ?? bodyError ?? (request.url.trim() ? `Requests to ${requestHost(request.url)} are allowed in this PVO.` : "Enter a URL to add its host to this PVO’s allowed domains.")}</p>
      <div className={requestStyles.routes}><button type="button" onClick={() => setRequestBranch("success")}><span>On success</span><strong>{outcomeName(request.onSuccess, s.scenes)}</strong></button><button type="button" onClick={() => setRequestBranch("error")}><span>On error / offline</span><strong>{request.onError ? outcomeName(request.onError, s.scenes) : "Do nothing"}</strong></button></div>
    </div>}
    {selected?.kind === "scene" && <p className={cx("componentFootnote")}>{component.branchAtEnd
      ? "The answer opens that scene when this layer ends."
      : "Playback moves to that scene as soon as viewers tap. When that scene ends, the video ends."}</p>}
  </SheetFrame>;
}
