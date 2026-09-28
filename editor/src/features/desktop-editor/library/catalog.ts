export const LIBRARY_TABS = [
  { id: "media", label: "Media", path: "m15 10 4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" },
  { id: "audio", label: "Audio", path: "M9 18V6l12-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  { id: "text", label: "Text", path: "M4 7V5h16v2M9 20h6M12 5v15" },
  { id: "captions", label: "Captions", path: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 14h4M14 14h3M7 10h10" },
  { id: "effects", label: "Effects", path: "m14 5 5 5M5 14l5 5M13 6l5 5-9 9-5-5zM19 3l2 2-3 1 1-3z" },
  { id: "transitions", label: "Transitions", path: "M4 5l8 7-8 7zM20 5l-8 7 8 7z" },
  { id: "components", label: "Components", path: "M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 10h18M9 10v10" },
  { id: "scenes", label: "Scenes", path: "M4 3h5v5H4zM15 10h5v5h-5zM15 17h5v5h-5zM6.5 8v11.5H15M6.5 12.5H15" },
] as const;

export const LIBRARY_SECTIONS: Record<string, readonly (readonly [string, string])[]> = {
  media: [["clips", "Your clips"], ["samples", "Samples"]],
  audio: [["music", "Music"], ["sfx", "Sound FX"]],
  text: [["presets", "Presets"], ["titles", "Titles"], ["lower", "Lower thirds"]],
  captions: [["auto", "Auto captions"], ["styles", "Styles"]],
  effects: [["trending", "Trending"], ["ai", "✦ AI restyle"], ["retro", "Retro"], ["light", "Light"], ["motion", "Motion"], ["glitch", "Glitch"]],
  transitions: [["basic", "Basic"], ["camera", "Camera"], ["wipe", "Wipes"]],
  components: [["starters", "Starters"], ["yours", "In this project"]],
  scenes: [],
};

export const EFFECTS: Record<string, readonly string[]> = {
  trending: ["Film grain", "Light leak", "Zoom punch", "Soft glow", "Chromatic", "Shake"],
  ai: ["Anime", "Clay", "Film noir", "Watercolor", "Comic", "Neon city"],
  retro: ["Retro VHS", "8mm", "Sepia", "Polaroid", "Scanlines", "Faded"],
  light: ["Lens flare", "Bloom", "Sun rays", "Prism", "Glow edge", "Flicker"],
  motion: ["Slow zoom", "Pan left", "Bounce", "Tilt", "Spin in", "Whip"],
  glitch: ["Glitch pop", "RGB split", "Pixel sort", "Datamosh", "Static", "Freeze"],
};

export const TRANSITIONS: Record<string, readonly string[]> = {
  basic: ["Crossfade", "Dip to black", "Slide left", "Push up", "Zoom in", "Spin"],
  camera: ["Whip pan", "Dolly zoom", "Shake cut"],
  wipe: ["Wipe right", "Circle wipe", "Clock wipe"],
};
