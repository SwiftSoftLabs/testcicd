export function stopMediaStreamTrack(
  track: MediaStreamTrack | null | undefined,
): void {
  if (!track || track.readyState === "ended") return;
  try {
    track.stop();
  } catch {
    /* already stopped */
  }
}
