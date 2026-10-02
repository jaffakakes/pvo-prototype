import { objectTrackingTimes } from "../packages/pvo-assistant/native/index.js";

// Actual 16x16 JPEG, generated from a black ffmpeg frame. Inference remains a fixture.
export const trackingJpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAACAEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABAAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJ/AB//Z";
export const trackingInput = () => ({ sceneId: "main", clipId: 1, start: 0, end: .2,
  target: { kind: "point", x: .4, y: .6 }, width: 16, height: 16,
  frames: objectTrackingTimes(0, .2).map(time => ({ time, imageDataUrl: trackingJpeg })) });
export const trackingOutput = () => ({ model: "sam3.1", width: 16, height: 16,
  frames: objectTrackingTimes(0, .2).map(time => ({ time, visible: true, x: .4, y: .6, width: .2, height: .3, score: .9 })) });
