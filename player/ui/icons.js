const paths = {
  play: '<path d="M9 5v14l11-7z" fill="currentColor" stroke="none"/>',
  hold: '<path d="M6 5h2.6v14H6zM11 5v14l9-7z" fill="currentColor" stroke="none"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>',
  error: '<path d="M12 7v6M12 17h.01"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>',
};

/** Decorative player glyphs; the surrounding control supplies its accessible name. */
export function playerIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.play}</svg>`;
}
