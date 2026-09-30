type PausableMedia = Pick<HTMLMediaElement, "pause">;

type PlaybackFrameFailure = {
  isTrying(): boolean;
  failTry(error: unknown): void;
  stopPlayback(error: unknown): void;
};

/** Keep the media element and editor clock together if one playback frame fails. */
export function runPlaybackFrame<T>(
  frame: (value: T) => void,
  value: T,
  media: PausableMedia | null,
  failure: PlaybackFrameFailure,
): void {
  try {
    frame(value);
  } catch (error) {
    media?.pause();
    if (failure.isTrying()) failure.failTry(error);
    else failure.stopPlayback(error);
  }
}
