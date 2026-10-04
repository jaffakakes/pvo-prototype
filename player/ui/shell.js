import { playerIcon } from "./icons.js";

const markUrl = new URL("../assets/restyle-mark.png", import.meta.url).href;
const accents = {
  orange: ["#FF8A00", "#141118"],
  emerald: ["#00E5A0", "#141118"],
  cyan: ["#00D4FF", "#141118"],
  violet: ["#8B2DFF", "#F2F0E9"],
  magenta: ["#FF2D78", "#141118"],
  blue: ["#3D5AFE", "#F2F0E9"],
};

function mark(extraClass = "") {
  return `<span class="mark-tile ${extraClass}"><img src="${markUrl}" alt="" /></span>`;
}

function shareButton(extraClass = "") {
  return `<button class="sticker-button share-button ${extraClass}" data-player-share type="button">${playerIcon("share")}<span>Share</span></button>`;
}

function createLink(extraClass = "", label = "Create a video") {
  return `<a class="sticker-button create-button ${extraClass}" href="/">${label}</a>`;
}

function metadata() {
  return '<div class="video-metadata"><span class="video-title" data-player-title>Untitled video</span><span class="video-meta" data-player-meta></span></div>';
}

/** Shared document presentation for local files and published videos. */
export function mountPlayerShell() {
  const shell = document.querySelector("#playerShell");
  if (!shell || shell.querySelector("#playerFrame")) return;
  const query = new URLSearchParams(window.location.search);
  const names = Object.keys(accents);
  const pinned = query.get("cta");
  const colour = Object.hasOwn(accents, pinned) ? pinned : names[Math.floor(Math.random() * names.length)];
  const [background, foreground] = accents[colour];
  shell.style.setProperty("--cta-bg", background);
  shell.style.setProperty("--cta-text", foreground);
  shell.dataset.cta = colour;
  shell.classList.toggle("debug-hits", query.get("debugHits") === "1");
  shell.innerHTML = `
    <div class="player-frame" id="playerFrame" data-state="paused">
      <canvas class="player-ambient" id="ambientCanvas" aria-hidden="true"></canvas>
      <video id="video" playsinline preload="auto"></video>
      <div class="video-dim" id="videoDim" aria-hidden="true"></div>
      <div class="overlay-layer" id="overlayLayer"></div>
      <div class="status-widget" id="statusWidget">
        <button class="sound-sticker" id="muteButton" type="button" aria-label="Unmute" aria-pressed="true">
          <span class="status-badge sound-badge" id="soundIcon">${playerIcon("muted")}</span>
          <span id="soundLabel">Unmute</span>
        </button>
        <div class="hold-sticker" id="holdStatus" role="status" aria-live="polite" hidden>
          <span class="status-badge hold-badge" id="holdBadge">${playerIcon("hold")}</span>
          <span id="holdLabel">Submit to continue</span>
          <span class="status-badge arrow-badge" id="holdArrow" aria-hidden="true">↓</span>
          <button class="retry-button" id="retryButton" type="button" hidden>Retry</button>
        </div>
      </div>
      <div class="brand-sticker" id="brandSticker" aria-label="Made with Restyle">
        <a class="brand-mark-link" id="brandMarkLink" href="/" aria-label="Made with Restyle">${mark()}<span class="brand-caption">Made with Restyle</span></a>
        <a class="brand-create" id="brandCreateLink" href="/" tabindex="-1">Create a video</a>
      </div>
      <button class="center-play" id="centerPlayButton" type="button" aria-label="Play" hidden>${playerIcon("play")}</button>
      <div class="end-screen" id="endScreen" hidden>
        <button class="restart-experience" id="endRestartButton" type="button">${playerIcon("restart")}<span>Watch again</span></button>
      </div>
      <div class="keyboard-accessory"><button id="keyboardDoneButton" type="button">Done</button></div>
      <span id="timelineLabel" hidden>Main timeline</span>
      <p class="player-status" id="status" aria-live="polite"></p>
    </div>
    <header class="player-header">
      <a class="restyle-brand" href="/" aria-label="Restyle home">${mark()}<span class="restyle-wordmark">restyle</span></a>
      <div class="chrome-spacer"></div>
      ${shareButton()}
      ${createLink()}
    </header>
    <footer class="player-footer">
      ${mark("footer-mark")}
      ${metadata()}
      ${shareButton("footer-share")}
      ${createLink("footer-create", '<span class="create-short">Create</span><span class="create-long">Create a video</span>')}
      <a class="made-with-sticker" href="/">${mark()}<span>Made with Restyle</span></a>
    </footer>
    <aside class="player-side-panel">
      <a class="panel-brand restyle-brand" href="/">${mark()}<span class="panel-brand-copy"><span class="restyle-wordmark">restyle</span><span class="panel-byline">Made with Restyle</span></span></a>
      <div class="panel-rule"></div>
      ${metadata()}
      <div class="chrome-spacer"></div>
      ${createLink()}
      ${shareButton()}
    </aside>
  `;
}
