import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useCapture } from "../../state/captureStore";
import {
  rememberUsedSound,
  toggleSavedSound,
  useSoundLibrary,
} from "../../state/preferences/soundLibrary";
import { Icon } from "../../ui/Icon";
import styles from "./SoundBrowser.module.css";

type Sound = {
  id: string;
  name: string;
  by: string;
  len: string;
  color: string;
};
type Props = {
  sounds: readonly Sound[];
  preview: {
    selected: string | null;
    playing: boolean;
    select(id: string): void;
    toggle(): void;
  };
  onUse(id: string): boolean;
  original?: ReactNode;
  inUseId?: string;
  inlineUse?: boolean;
};
const TABS = ["For you", "Saved", "Recent"] as const;
type Tab = (typeof TABS)[number];

export function SoundBrowser({
  sounds,
  preview,
  onUse,
  original,
  inUseId,
  inlineUse = true,
}: Props) {
  const [tab, setTab] = useState<Tab>("For you");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const library = useSoundLibrary();
  const id = useId();
  const tabId = (name: Tab) => `${id}-${TABS.indexOf(name)}`;
  const selected = sounds.find((sound) => sound.id === preview.selected);
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };
  const useSound = (id: string) => {
    if (!onUse(id)) return;
    const sound = sounds.find((sound) => sound.id === id);
    if (sound) rememberUsedSound(sound.name);
    useCapture.getState().patch({ sheet: null });
  };
  const changeTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    setTab(TABS[next]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("button")
      [next]?.focus();
  };
  let items = [...sounds];
  if (!searching && tab === "Recent")
    items = library.recent.flatMap((name) =>
      sounds.filter((sound) => sound.name === name),
    );
  if (!searching && tab === "Saved")
    items = items.filter((sound) => library.saved.includes(sound.name));
  if (query.trim())
    items = items.filter((sound) =>
      `${sound.name} ${sound.by}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );

  return (
    <div
      className={styles.browser}
      onKeyDown={(event) => {
        if (searching && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }
      }}
    >
      <header className={styles.toolbar}>
        {searching ? (
          <label className={styles.search}>
            <Icon name="search" size={18} />
            <input
              autoFocus
              aria-label="Search sounds"
              placeholder="Search sounds"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : (
          <>
            <div
              className={styles.tabs}
              role="tablist"
              aria-label="Sound library"
            >
              {TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  id={tabId(name)}
                  aria-controls={`${id}-list`}
                  aria-selected={tab === name}
                  tabIndex={tab === name ? 0 : -1}
                  onKeyDown={changeTab}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              className={styles.iconButton}
              type="button"
              aria-label="Search sounds"
              onClick={() => setSearching(true)}
            >
              <Icon name="search" size={21} />
            </button>
          </>
        )}
        <button
          className={`${styles.iconButton} ${styles.close}`}
          type="button"
          aria-label={searching ? "Close search" : "Close"}
          onClick={
            searching
              ? closeSearch
              : () => useCapture.getState().patch({ sheet: null })
          }
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div
        className={styles.list}
        role={searching ? "region" : "tabpanel"}
        id={`${id}-list`}
        aria-label={searching ? "Sound search results" : undefined}
        aria-labelledby={searching ? undefined : tabId(tab)}
        tabIndex={0}
      >
        {original}
        {items.map((sound) => {
          const active = preview.selected === sound.id;
          const saved = library.saved.includes(sound.name);
          return (
            <div className={styles.row} key={sound.name} data-preview={active}>
              <button
                type="button"
                className={styles.choice}
                aria-label={`Preview ${sound.name}`}
                aria-pressed={active}
                onClick={() => preview.select(sound.id)}
              >
                <i className={styles.art} style={{ background: sound.color }} />
                <span className={styles.info}>
                  <strong>
                    {active && preview.playing && (
                      <Icon name="waveform" size={16} />
                    )}
                    {sound.name}
                  </strong>
                  <small>
                    {sound.by} · {sound.len}
                  </small>
                </span>
              </button>
              {active && inlineUse && !preview.playing && !searching ? (
                <button
                  className={styles.use}
                  type="button"
                  aria-label={`Use ${sound.name}`}
                  onClick={() => useSound(sound.id)}
                >
                  Use
                </button>
              ) : active ? (
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label={`${saved ? "Unsave" : "Save"} ${sound.name}`}
                  aria-pressed={saved}
                  onClick={() => toggleSavedSound(sound.name)}
                >
                  <Icon
                    name={saved ? "bookmarkFilled" : "bookmark"}
                    size={20}
                  />
                </button>
              ) : inUseId === sound.id ? (
                <span className={styles.inUse}>
                  <Icon name="check" size={15} />
                  In use
                </span>
              ) : null}
            </div>
          );
        })}
        {!items.length && (
          <p className={styles.empty}>
            {searching
              ? "No sounds found."
              : tab === "Saved"
                ? "No saved sounds yet."
                : "No recent sounds yet."}
          </p>
        )}
        {library.storageSaveFailed && tab === "Saved" && (
          <p className={styles.empty}>Saved for this session.</p>
        )}
      </div>
      {selected && (
        <footer
          className={styles.preview}
          role="group"
          aria-label="Sound preview"
          data-playing={preview.playing}
        >
          <button
            className={styles.play}
            type="button"
            aria-label={
              preview.playing ? "Pause sound preview" : "Play sound preview"
            }
            onClick={preview.toggle}
          >
            <Icon name={preview.playing ? "pause" : "play"} size={17} />
          </button>
          <span className={styles.previewInfo}>
            <strong>{selected.name}</strong>
            <small>
              {selected.by} · {selected.len}
            </small>
          </span>
          <span className={styles.wave} aria-hidden="true">
            <Icon name="waveform" size={30} />
          </span>
          <button
            className={styles.previewUse}
            type="button"
            aria-label="Use sound"
            onClick={() => useSound(selected.id)}
          >
            Use
          </button>
        </footer>
      )}
    </div>
  );
}
