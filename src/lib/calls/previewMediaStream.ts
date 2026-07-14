/** Acquire preview stream; falls back to audio-only when camera access fails. */
export async function acquirePreviewStream(
  cameraId?: string,
  micId?: string,
): Promise<{ stream: MediaStream; videoUnavailable: boolean }> {
  const video = cameraId ? { deviceId: { exact: cameraId } } : true;
  const audio = micId ? { deviceId: { exact: micId } } : true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    return { stream, videoUnavailable: false };
  } catch (primaryError) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio,
      });
      return { stream, videoUnavailable: true };
    } catch (audioError) {
      throw audioError;
    }
  }
}
