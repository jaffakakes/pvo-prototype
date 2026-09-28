import { useCapture } from "../../../state/captureStore";
import { addLibraryComponent, selectLibraryComponent } from "../../../state/editing/libraryCommands";
import { defaultFields } from "../../../domain/components/defaults";
import type { PvoComponent } from "../../../domain/project/model";
import { TYPES, nameOf } from "../../component-authoring/catalog";
import { LookPreview } from "../../component-authoring/look/LookPreview";
import { fmt } from "../../../ui/formatTime";
import { AddBadge, LibraryHeading, LibraryNotice } from "./LibraryParts";
import styles from "./Library.module.css";

const SUBTITLES = ["Display only", "Title, text and a button", "Two options, each can branch", "Fields viewers send you"];

export function ComponentLibrary({ section }: { section: string }) {
  const scenes = useCapture(state => state.scenes);
  const currentId = useCapture(state => state.currentSceneId);
  const time = useCapture(state => state.t);
  const selected = useCapture(state => state.selComp);
  const scene = scenes.find(item => item.id === currentId);
  const components = scenes.flatMap(owner => owner.components.map(component => ({ component, owner })));

  if (section === "yours") return <>
    <LibraryHeading count={`${components.length} items`}>In this project</LibraryHeading>
    {components.map(({ component, owner }) => <button type="button" key={component.id}
      className={styles.projectComponent} aria-pressed={selected === component.id}
      onClick={() => selectLibraryComponent(owner.id, component.id)}>
      <span className={styles.componentDot} />
      <span><strong>{nameOf(component.type)}</strong><small>{owner.name} · {fmt(component.at)}</small></span>
    </button>)}
    {!components.length && <LibraryNotice>Your components will appear here. Choose a starter to add one.</LibraryNotice>}
  </>;

  return <>
    <LibraryHeading count="4 starters">Components</LibraryHeading>
    <LibraryNotice>Lands at {fmt(time)} in {scene?.name ?? "this scene"} with the Bold look — restyle it on the right.</LibraryNotice>
    <div className={styles.starterGrid}>
      {TYPES.map((item, index) => {
        const preview: PvoComponent = {
          id: `starter-${item.type}`, type: item.type, sceneId: currentId,
          at: 0, dur: 3, x: 50, y: 50, fields: defaultFields(item.type),
        };
        return <button type="button" className={styles.starter} key={item.type} onClick={() => addLibraryComponent(item.type)}>
          <span className={styles.starterPreview}><LookPreview component={preview} preset="bold" /><AddBadge /></span>
          <strong>{item.name}</strong>
          <small>{SUBTITLES[index]}</small>
        </button>;
      })}
    </div>
  </>;
}
