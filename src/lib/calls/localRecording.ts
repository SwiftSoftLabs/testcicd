/** MIME type for stored recording files (playback + Gemini). */
export function recordingMimeFromKey(
  storageKey: string,
  blobType?: string,
): string {
  if (blobType?.startsWith("video/") || blobType?.startsWith("audio/")) {
    return blobType.replace(/;\s+/g, ";");
  }
  if (storageKey.endsWith(".webm")) return "video/webm";
  if (storageKey.endsWith(".mp4")) return "video/mp4";
  return "video/webm";
}

/** Content-Type for HTTP video responses (playback route). */
export function playbackContentType(
  storageKey: string,
  storedFileType?: string | null,
  downloadedBlobType?: string,
): string {
  return recordingMimeFromKey(
    storageKey,
    storedFileType?.trim() || downloadedBlobType,
  );
}

const RECORD_FPS = 15;
const RECORD_WIDTH = 1280;
const RECORD_HEIGHT = 720;

/** Pick a video MediaRecorder mime type supported in this browser. */
export function preferredRecorderMimeType(): string {
  const videoCandidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const mime of videoCandidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime;
    }
  }
  const audioCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of audioCandidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime;
    }
  }
  return "video/webm";
}

function videoElementForTrack(track: MediaStreamTrack): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => {});
  return video;
}

/**
 * Composites all meeting participant video tiles into one stream and mixes audio.
 * Uses cloned MediaStreamTracks so Agora device tracks are not held open by the recorder.
 */
export class MeetingCompositeRecorder {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly audioContext: AudioContext;
  private readonly audioDest: MediaStreamAudioDestinationNode;
  private readonly canvasStream: MediaStream;
  private readonly audioNodes = new Map<string, MediaStreamAudioSourceNode>();
  private readonly videoEls = new Map<string, HTMLVideoElement>();
  private readonly ownedTracks = new Map<string, MediaStreamTrack>();
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private rafId: number | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = RECORD_WIDTH;
    this.canvas.height = RECORD_HEIGHT;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
    this.audioContext = new AudioContext();
    this.audioDest = this.audioContext.createMediaStreamDestination();

    const mimeType = preferredRecorderMimeType();
    this.canvasStream = this.canvas.captureStream(RECORD_FPS);
    const combined = new MediaStream([
      ...this.canvasStream.getVideoTracks(),
      ...this.audioDest.stream.getAudioTracks(),
    ]);
    this.recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 1_500_000,
      audioBitsPerSecond: 128_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
  }

  setAudioTrack(id: string, track: MediaStreamTrack) {
    this.removeAudioTrack(id);
    const owned = track.clone();
    this.ownedTracks.set(`${id}-audio`, owned);
    const node = this.audioContext.createMediaStreamSource(
      new MediaStream([owned]),
    );
    node.connect(this.audioDest);
    this.audioNodes.set(id, node);
  }

  removeAudioTrack(id: string) {
    this.audioNodes.get(id)?.disconnect();
    this.audioNodes.delete(id);
    const owned = this.ownedTracks.get(`${id}-audio`);
    if (owned) {
      owned.stop();
      this.ownedTracks.delete(`${id}-audio`);
    }
  }

  setVideoTrack(id: string, track: MediaStreamTrack) {
    this.removeVideoTrack(id);
    const owned = track.clone();
    this.ownedTracks.set(`${id}-video`, owned);
    this.videoEls.set(id, videoElementForTrack(owned));
  }

  removeVideoTrack(id: string) {
    const video = this.videoEls.get(id);
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    this.videoEls.delete(id);
    const owned = this.ownedTracks.get(`${id}-video`);
    if (owned) {
      owned.stop();
      this.ownedTracks.delete(`${id}-video`);
    }
  }

  start() {
    void this.audioContext.resume();
    const tick = () => {
      this.paintFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
    this.recorder.start(1000);
  }

  private paintFrame() {
    const videos = Array.from(this.videoEls.values());
    const n = Math.max(videos.length, 1);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = this.canvas.width / cols;
    const cellH = this.canvas.height / rows;

    this.ctx.fillStyle = "#0f0f0f";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    videos.forEach((video, i) => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      try {
        this.ctx.drawImage(video, col * cellW, row * cellH, cellW, cellH);
      } catch {
        /* skip bad frame */
      }
    });
  }

  async stop(): Promise<Blob | null> {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const blob = await stopMediaRecorder(this.recorder, this.chunks);

    for (const id of [...this.videoEls.keys()]) this.removeVideoTrack(id);
    for (const id of [...this.audioNodes.keys()]) this.removeAudioTrack(id);
    for (const track of this.ownedTracks.values()) {
      if (track.readyState !== "ended") track.stop();
    }
    this.ownedTracks.clear();

    for (const track of this.canvasStream.getVideoTracks()) {
      if (track.readyState !== "ended") track.stop();
    }

    await this.audioContext.close().catch(() => {});

    return blob;
  }
}

/** @deprecated Use MeetingCompositeRecorder for full meeting capture. */
export function createCallMediaRecorder(
  audioTrack: MediaStreamTrack,
  videoTrack?: MediaStreamTrack,
): { recorder: MediaRecorder; chunks: Blob[] } {
  const tracks = videoTrack ? [audioTrack, videoTrack] : [audioTrack];
  const stream = new MediaStream(tracks);
  const mimeType = preferredRecorderMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: 128_000,
    ...(mimeType.startsWith("video/") ? { videoBitsPerSecond: 1_500_000 } : {}),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  return { recorder, chunks };
}

export function stopMediaRecorder(
  recorder: MediaRecorder,
  chunks: Blob[],
): Promise<Blob | null> {
  if (recorder.state === "inactive") {
    if (chunks.length === 0) return Promise.resolve(null);
    return Promise.resolve(new Blob(chunks, { type: recorder.mimeType }));
  }
  return new Promise((resolve) => {
    recorder.onstop = () => {
      resolve(
        chunks.length > 0
          ? new Blob(chunks, { type: recorder.mimeType })
          : null,
      );
    };
    recorder.onerror = () => resolve(null);
    recorder.stop();
  });
}
