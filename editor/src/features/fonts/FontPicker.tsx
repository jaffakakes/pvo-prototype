import { useEffect, useRef, useState } from "react";
import { fontFamily, loadFontAsset, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";
import {
  downloadWebFont, importFontUrl, isFontFileUrl, searchFontSources, searchGoogleFonts,
  type FontSource, type WebFont,
} from "../../infrastructure/fonts/catalogue";
import { initializeFontLibrary, saveLibraryFont, useFontLibrary } from "../../state/fonts/fontLibraryStore";
import styles from "./FontPicker.module.css";

export function FontPicker({ value, onChange, disabled = false }: {
  value?: AppliedFont; onChange(font: AppliedFont | undefined): void; disabled?: boolean;
}) {
  const library = useFontLibrary();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"web" | "google">("web");
  const [sources, setSources] = useState<FontSource[]>([]);
  const [googleFonts, setGoogleFonts] = useState<WebFont[]>([]);
  const [searched, setSearched] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [family, setFamily] = useState("");
  const [url, setUrl] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [preview, setPreview] = useState<AppliedFont | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => {
    let active = true;
    if (open) void initializeFontLibrary().catch(error => { if (active) setError(error.message); });
    else { request.current?.abort(); setBusy(""); }
    return () => { active = false; };
  }, [open]);
  useEffect(() => { if (disabled) { request.current?.abort(); setOpen(false); } }, [disabled]);

  const cancelRequest = () => {
    request.current?.abort();
    request.current = null;
    setBusy("");
  };
  const close = () => { cancelRequest(); setOpen(false); };
  const editImport = (change: () => void) => {
    cancelRequest();
    setPreview(null);
    setError(null);
    change();
  };
  const run = async (label: string, task: (signal: AbortSignal) => Promise<void>) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(label);
    setError(null);
    try { await task(controller.signal); }
    catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't load this font.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(""); }
    }
  };
  const showPreview = async (font: AppliedFont, signal: AbortSignal) => {
    signal.throwIfAborted();
    await loadFontAsset(font);
    signal.throwIfAborted();
    setPreview(font);
  };
  const select = (font: AppliedFont) => {
    setPreview(null);
    void run("Loading preview…", signal => showPreview(font, signal));
  };
  const search = () => {
    setSearched(false);
    setSources([]);
    setGoogleFonts([]);
    void run(searchScope === "web" ? "Searching the web…" : "Searching Google Fonts…", async signal => {
      if (searchScope === "web") {
        const results = await searchFontSources(query, signal);
        signal.throwIfAborted();
        setSources(results);
      } else {
        const fonts = await searchGoogleFonts(query, signal);
        signal.throwIfAborted();
        setGoogleFonts(fonts);
      }
      setSearched(true);
    });
  };
  const changeSearchScope = (scope: "web" | "google") => {
    cancelRequest();
    setSearchScope(scope);
    setSources([]);
    setGoogleFonts([]);
    setSearched(false);
    setError(null);
  };
  const importPreview = () => {
    setPreview(null);
    void run("Downloading font preview…", async signal => {
      const font = await importFontUrl({ family, url, licenseUrl }, signal);
      await showPreview(font, signal);
    });
  };
  const apply = () => {
    if (!preview) return;
    void run("Saving font…", async signal => {
      await saveLibraryFont(preview);
      signal.throwIfAborted();
      onChange(preview);
      setOpen(false);
    });
  };

  return <section className={styles.root} data-font-picker>
    <div className={styles.heading}>
      <span>Font</span>
      <button type="button" disabled={disabled} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
        {value?.family ?? "Default font"} · Browse fonts
      </button>
    </div>
    {open && <div className={styles.library}>
      <p>Find fonts on the web. Saved fonts are available in all your projects in this browser.</p>
      <div className={styles.actions} role="group" aria-label="Font search source">
        <button type="button" aria-pressed={searchScope === "web"} onClick={() => changeSearchScope("web")}>Web search</button>
        <button type="button" aria-pressed={searchScope === "google"} onClick={() => changeSearchScope("google")}>Google Fonts catalogue</button>
      </div>
      <div className={styles.search}>
        <input aria-label="Search web fonts" value={query} maxLength={200} placeholder="Font name, foundry or style…"
          onChange={event => {
            cancelRequest();
            setQuery(event.target.value);
            setSources([]);
            setGoogleFonts([]);
            setSearched(false);
          }} onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); search(); }
          }} />
        <button type="button" onClick={search} disabled={searchScope === "web" && !query.trim()}>
          {searchScope === "web" ? "Search web" : "Search Google Fonts"}
        </button>
      </div>
      {busy && <p role="status">{busy}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {searched && !sources.length && !googleFonts.length && <p role="status">No results. Try another name or style.</p>}
      {!!sources.length && <ul className={styles.sources} aria-label="Web font sources">
        {sources.map(source => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          <small>{new URL(source.url).hostname}</small>
          <p>{source.snippet}</p>
          {isFontFileUrl(source.url) && <button type="button" onClick={() => {
            cancelRequest();
            setPreview(null);
            setError(null);
            setUrl(source.url);
            setImportOpen(true);
          }}>Use font file URL</button>}
        </li>)}
      </ul>}
      {!!googleFonts.length && <div className={styles.results} aria-label="Google Fonts results">
        {googleFonts.map(font => <button type="button" key={font.id}
          onClick={() => {
            setPreview(null);
            void run("Downloading font preview…", async signal => {
              const downloaded = library.fonts.find(item => item.id === font.id) ?? await downloadWebFont(font.id, signal);
              await showPreview(downloaded, signal);
            });
          }}>
          <strong>{font.family}</strong><small>{font.category} · Preview font</small>
        </button>)}
      </div>}
      <details className={styles.import} open={importOpen} onToggle={event => setImportOpen(event.currentTarget.open)}>
        <summary>Import font URL</summary>
        <p>Use a direct WOFF2, WOFF, TTF or OTF file link and its licence link.</p>
        <label>Font family name<input value={family} maxLength={100} onChange={event => editImport(() => setFamily(event.target.value))} /></label>
        <label>Font file URL<input type="url" value={url} maxLength={2048} placeholder="https://…/font.woff2"
          onChange={event => editImport(() => setUrl(event.target.value))} /></label>
        <label>Licence URL<input type="url" value={licenseUrl} maxLength={2048} placeholder="https://…/licence"
          onChange={event => editImport(() => setLicenseUrl(event.target.value))} /></label>
        <button type="button" disabled={!family.trim() || !url.trim() || !licenseUrl.trim()} onClick={importPreview}>Preview font</button>
      </details>
      <h4>Saved fonts</h4>
      {!library.fonts.length && <p>No saved fonts yet.</p>}
      {!!library.fonts.length && <div className={styles.results} aria-label="Saved fonts">
        {library.fonts.map(font => <button type="button" key={font.id}
          onClick={() => select(font)} aria-pressed={preview?.id === font.id}>{font.family}</button>)}
      </div>}
      {preview && <div className={styles.preview} data-font-preview>
        <p className={styles.sample} style={{ fontFamily: fontFamily(preview) }}>The quick brown fox<br />0123456789</p>
        <strong>{preview.family}</strong>
        <div className={styles.actions}>
          <button type="button" disabled={!!busy} onClick={apply}>Save & apply font</button>
          <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer">Font source</a>
          <a href={preview.licenseUrl} target="_blank" rel="noopener noreferrer">Usage licence</a>
        </div>
      </div>}
      <div className={styles.actions}>
        {value && <button type="button" disabled={!!busy} onClick={() => { onChange(undefined); close(); }}>Use default font</button>}
        <button type="button" onClick={close}>Close fonts</button>
      </div>
    </div>}
  </section>;
}
