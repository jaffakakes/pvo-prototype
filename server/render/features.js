/** Identify authored effects that the current FFmpeg renderer cannot reproduce. */
export function unsupportedRenderEffects(source) {
  if ((source.clipGain !== undefined && source.clipGain !== 1)
    || (source.musicGain !== undefined && source.musicGain !== 1) || source.musicAnimation)
    return "Server export does not yet support adjusted audio gain or music animation.";
  if (source.clips.some(clip => clip?.animation))
    return "Server export does not yet support video animation.";
  if ((source.audioClips ?? []).some(clip => clip?.animation || (clip?.gain !== undefined && clip.gain !== 1)))
    return "Server export does not yet support adjusted audio layers or gain animation.";
  return null;
}
