/** Paint the existing media element; no duplicate playback or audio resource. */
export function createAmbientVideo({ video, canvas }) {
  const context = canvas?.getContext("2d", { alpha: false });
  if (!context) return { update() {}, destroy() {} };
  canvas.width = 160;
  canvas.height = 100;
  let timer = 0;
  let destroyed = false;

  function paint() {
    if (destroyed || document.hidden || !video.videoWidth || video.readyState < 2) return;
    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  function stop() {
    window.clearTimeout(timer);
    timer = 0;
  }

  function update() {
    stop();
    paint();
    if (!destroyed && !video.paused && !video.ended && !document.hidden) {
      timer = window.setTimeout(update, 120);
    }
  }

  const events = ["play", "pause", "loadeddata", "seeked", "emptied"];
  events.forEach(type => video.addEventListener(type, update));
  document.addEventListener("visibilitychange", update);
  update();
  return {
    update,
    destroy() {
      destroyed = true;
      stop();
      events.forEach(type => video.removeEventListener(type, update));
      document.removeEventListener("visibilitychange", update);
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
