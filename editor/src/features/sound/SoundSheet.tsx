import { useId, useState, type KeyboardEvent } from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { setLibraryMusic } from "../../state/editing/libraryCommands";
import {
  rememberUsedSound,
  toggleSavedSound,
  useSoundLibrary,
} from "../../state/preferences/soundLibrary";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { Shell } from "../../ui/SheetShell";
import { SOUNDS } from "./catalog";
import { useMusicPreview } from "./useMusicPreview";
import styles from "./SoundSheet.module.css";

const TABS = ["For you", "Saved", "Recent"] as const;
type Tab = (typeof TABS)[number];

export function SoundSheet() {
  const soundIndex = useCapture((state) => state.sound);
  const duration = useCapture((state) => sceneDuration(state));
  const [title] = useState(() =>
    soundIndex > 0 ? "Replace sound" : "Add sound",
  );
  const [tab, setTab] = useState<Tab>("For you");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const library = useSoundLibrary();
  const preview = useMusicPreview();
  const id = useId();
  const tabId = (name: Tab) => `${id}-${TABS.indexOf(name)}`;
  const selected = preview.selected !== null ? SOUNDS[preview.selected] : null;
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };
  const useSound = (index: number) => {
    if (!setLibraryMusic(index)) return;
    if (index > 0) rememberUsedSound(SOUNDS[index].name);
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
  let indexes = SOUNDS.map((_, index) => index).slice(1);
  if (!searching && tab === "Recent")
    indexes = library.recent
      .map((name) => SOUNDS.findIndex((sound) => sound.name === name))
      .filter((index) => index > 0);
  if (!searching && tab === "Saved")
    indexes = indexes.filter((index) =>
      library.saved.includes(SOUNDS[index].name),
    );
  if (query.trim())
    indexes = indexes.filter((index) =>
      `${SOUNDS[index].name} ${SOUNDS[index].by}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );

  return (
    <Shell title={title} headerless>
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
          <div className={styles.row}>
            <button
              type="button"
              className={styles.choice}
              aria-label="Use Original sound"
              onClick={() => useSound(0)}
            >
              <i className={`${styles.art} ${styles.original}`}>
                <Icon name="edit" size={22} />
              </i>
              <span className={styles.info}>
                <strong>Original sound</strong>
                <small>From your clips · {fmt(duration)}</small>
              </span>
            </button>
            {soundIndex === 0 ? (
              <span className={styles.inUse}>
                <Icon name="check" size={15} />
                In use
              </span>
            ) : (
              <button
                className={styles.use}
                type="button"
                onClick={() => useSound(0)}
                aria-label="Use original clip sound"
              >
                Use
              </button>
            )}
          </div>
          {indexes.map((index) => {
            const sound = SOUNDS[index];
            const active = preview.selected === index;
            const saved = library.saved.includes(sound.name);
            return (
              <div
                className={styles.row}
                key={sound.name}
                data-preview={active}
              >
                <button
                  type="button"
                  className={styles.choice}
                  aria-label={`Preview ${sound.name}`}
                  aria-pressed={active}
                  onClick={() => preview.select(index)}
                >
                  <i
                    className={styles.art}
                    style={{ background: sound.color }}
                  />
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
                {active && !preview.playing && !searching ? (
                  <button
                    className={styles.use}
                    type="button"
                    aria-label={`Use ${sound.name}`}
                    onClick={() => useSound(index)}
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
                ) : soundIndex === index ? (
                  <span className={styles.inUse}>
                    <Icon name="check" size={15} />
                    In use
                  </span>
                ) : null}
              </div>
            );
          })}
          {!indexes.length && (
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
              onClick={() => useSound(preview.selected!)}
            >
              Use
            </button>
          </footer>
        )}
      </div>
    </Shell>
  );
}
