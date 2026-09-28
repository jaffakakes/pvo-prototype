import { useState } from "react";
import { LIBRARY_SECTIONS, LIBRARY_TABS } from "./catalog";
import { AudioLibrary } from "./AudioLibrary";
import { ComponentLibrary } from "./ComponentLibrary";
import { MediaLibrary } from "./MediaLibrary";
import { SceneLibrary } from "./SceneLibrary";
import { TextLibrary } from "./TextLibrary";
import { UnavailableLibrary } from "./UnavailableLibrary";
import { LibrarySearch } from "./LibraryParts";
import { useLibraryMedia } from "./useLibraryMedia";
import styles from "./Library.module.css";

type Props = { tab: string; onTabChange(tab: string): void };

export function DesktopLibrary({ tab, onTabChange }: Props) {
  const [sections, setSections] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const activeTab = LIBRARY_TABS.some(item => item.id === tab) ? tab : "media";
  const choices = LIBRARY_SECTIONS[activeTab];
  const section = sections[activeTab] ?? choices[0]?.[0] ?? "";
  const label = choices.find(item => item[0] === section)?.[1] ?? "Scenes";
  const showSearch = !["scenes", "components"].includes(activeTab)
    && !(activeTab === "captions" && section === "auto");
  const media = useLibraryMedia(() => {
    onTabChange("media");
    setSections(previous => ({ ...previous, media: "clips" }));
    setQuery("");
  });

  return <aside className={styles.panel} aria-label="Library" data-desktop-library>
    <div className={styles.tabs} role="tablist" aria-label="Library">
      {LIBRARY_TABS.map(item => <button type="button" role="tab" key={item.id}
        aria-selected={activeTab === item.id} aria-label={item.label} title={item.label}
        onClick={() => { onTabChange(item.id); setQuery(""); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg>
        <span>{item.label}</span>
      </button>)}
    </div>
    <div className={styles.body}>
      {choices.length > 0 && <nav className={styles.subnav} aria-label={`${activeTab} categories`}>
        {choices.map(([id, name]) => <button type="button" key={id} aria-current={section === id ? "true" : undefined}
          onClick={() => { setSections(previous => ({ ...previous, [activeTab]: id })); setQuery(""); }}>{name}</button>)}
      </nav>}
      <div className={styles.content} role="tabpanel" aria-label={LIBRARY_TABS.find(item => item.id === activeTab)?.label}>
        {showSearch && <LibrarySearch section={label.toLowerCase()} query={query} onChange={setQuery} />}
        {activeTab === "media" && <MediaLibrary section={section} query={query} media={media} />}
        {activeTab === "audio" && <AudioLibrary section={section} query={query} />}
        {activeTab === "text" && <TextLibrary section={section} query={query} />}
        {activeTab === "components" && <ComponentLibrary section={section} />}
        {activeTab === "scenes" && <SceneLibrary />}
        {["effects", "transitions", "captions"].includes(activeTab)
          && <UnavailableLibrary tab={activeTab} section={section} label={label} query={query} />}
        {media.error && <p className={styles.error} role="alert">{media.error}</p>}
      </div>
    </div>
    <input ref={media.input} type="file" hidden multiple accept="video/*,.mp4,.mov,.m4v,.webm" aria-label="Import media" onChange={event => {
      media.addFiles(Array.from(event.target.files ?? []));
      event.target.value = "";
    }} />
    {media.dragging && <div className={styles.dropOverlay}><strong>Drop media to add it to your timeline</strong></div>}
  </aside>;
}
