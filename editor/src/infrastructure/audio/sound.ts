import { audioGain } from "../../domain/audio/gain";

// Small, deterministic instrumental loops for the prototype's named sound catalogue.
// The generated PCM is mixed into export, not merely represented by a selected row.
const NOTES = [
  [],
  [220, 261.63, 329.63, 392],
  [164.81, 196, 246.94, 293.66],
  [130.81, 164.81, 196, 261.63],
  [174.61, 220, 261.63, 349.23],
];
export function soundBuffer(context: AudioContext, track: number) {
  const seconds = 4;
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, seconds * rate, rate);
  const data = buffer.getChannelData(0);
  const notes = NOTES[track] || NOTES[1];
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    const beat = Math.floor(t * 2);
    const phase = t * 2 - beat;
    const frequency = notes[beat % notes.length];
    const envelope = Math.exp(-phase * 3.5);
    const bass = Math.sin(2 * Math.PI * frequency * 0.5 * t) * 0.15 * envelope;
    const chord = Math.sin(2 * Math.PI * frequency * t) * 0.065 * envelope;
    const kickPhase = t % 0.5;
    const kick =
      Math.sin(2 * Math.PI * (72 - 45 * kickPhase) * kickPhase) *
      0.16 *
      Math.exp(-kickPhase * 23);
    const hat =
      Math.sin(i * 17.39) *
      Math.sin(i * 3.71) *
      0.025 *
      Math.exp(-(t % 0.25) * 70);
    data[i] = bass + chord + kick + hat;
  }
  return buffer;
}
export function startSound(
  context: AudioContext,
  track: number,
  destination: AudioNode,
  volume = 1,
  offset = 0,
  when = 0,
  duration?: number,
) {
  const source = context.createBufferSource();
  source.buffer = soundBuffer(context, track);
  source.loop = true;
  const gain = context.createGain();
  gain.gain.value = audioGain(volume);
  source.connect(gain).connect(destination);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  source.start(
    when,
    ((offset % source.buffer.duration) + source.buffer.duration) %
      source.buffer.duration,
    duration,
  );
  return source;
}
export function previewSound(track: number) {
  if (!track) return () => {};
  const context = new AudioContext();
  const source = startSound(context, track, context.destination);
  let closed = false;
  const timer = window.setTimeout(stop, 1600);
  function stop() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    source.stop();
    void context.close();
  }
  return stop;
}
