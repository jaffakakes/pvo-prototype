import { create } from "zustand";
import { createFontScope, type AppliedFont } from "../../../../packages/pvo-fonts/index.js";
import { readSavedFonts, writeSavedFont } from "../../infrastructure/fonts/library";
import { downloadWebFont } from "../../infrastructure/fonts/catalogue";

type LibraryState = { fonts: AppliedFont[]; ready: boolean; error: string | null };
export const useFontLibrary = create<LibraryState>(() => ({ fonts: [], ready: false, error: null }));
let pending: Promise<void> | null = null;

export function initializeFontLibrary(): Promise<void> {
  if (useFontLibrary.getState().ready) return Promise.resolve();
  pending ??= readSavedFonts().then(fonts => { useFontLibrary.setState({ fonts, ready: true, error: null }); })
    .catch(error => {
      useFontLibrary.setState({ error: error instanceof Error ? error.message : "Couldn't open saved fonts." });
      throw error;
    }).finally(() => { pending = null; });
  return pending;
}

export async function saveLibraryFont(font: AppliedFont): Promise<void> {
  await initializeFontLibrary();
  const scope = createFontScope();
  try { await scope.load(font); }
  catch { throw new Error("This font file could not be opened. Choose another download."); }
  finally { scope.dispose(); }
  await writeSavedFont(font);
  useFontLibrary.setState(state => ({ fonts: [...state.fonts.filter(item => item.id !== font.id), font]
    .sort((a, b) => a.family.localeCompare(b.family)), error: null }));
}

export async function obtainLibraryFont(id: string, signal?: AbortSignal): Promise<AppliedFont> {
  await initializeFontLibrary();
  signal?.throwIfAborted();
  const saved = useFontLibrary.getState().fonts.find(font => font.id === id);
  if (saved) return saved;
  if (!id.startsWith("google-")) throw new Error("Import this web font before applying it.");
  const font = await downloadWebFont(id, signal);
  signal?.throwIfAborted();
  await saveLibraryFont(font);
  return font;
}
