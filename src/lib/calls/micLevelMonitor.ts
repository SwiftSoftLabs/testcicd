/** Maps RMS amplitude to a 0–100 meter value with log-ish scaling for speech. */
export function rmsToMicLevel(rms: number): number {
  if (rms <= 0) return 0;
  return Math.min(100, Math.pow(rms, 0.4) * 140);
}

export type MicLevelMonitor = {
  /** Call from a user gesture when the AudioContext may still be suspended. */
  resume: () => Promise<void>;
  stop: () => void;
};

export function createMicLevelMonitor(
  stream: MediaStream,
  getBarEl: () => HTMLElement | null,
): MicLevelMonitor {
  let animId = 0;
  let ctx: AudioContext | null = null;
  let polling = false;
  let stopped = false;
  let displayed = 0;
  let analyser: AnalyserNode | null = null;
  let onStateChange: (() => void) | null = null;

  const setBarWidth = (pct: number) => {
    const barEl = getBarEl();
    if (barEl) barEl.style.setProperty("--mic-level", `${pct}%`);
  };

  const stop = () => {
    stopped = true;
    polling = false;
    cancelAnimationFrame(animId);
    animId = 0;
    if (ctx && onStateChange) {
      ctx.removeEventListener("statechange", onStateChange);
    }
    void ctx?.close().catch(() => undefined);
    ctx = null;
    analyser = null;
    onStateChange = null;
    displayed = 0;
    setBarWidth(0);
  };

  const startPoll = () => {
    if (polling || stopped || !analyser) return;
    polling = true;
    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (stopped || !analyser) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = rmsToMicLevel(rms);
      displayed =
        level > displayed ? level : displayed * 0.82 + level * 0.18;
      setBarWidth(displayed);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  };

  const tryStart = () => {
    if (stopped || polling || !ctx || ctx.state !== "running") return;
    startPoll();
  };

  try {
    if (stream.getAudioTracks().length === 0) {
      return { resume: async () => undefined, stop };
    }

    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const silentOut = ctx.createGain();
    silentOut.gain.value = 0;
    src.connect(analyser);
    analyser.connect(silentOut);
    silentOut.connect(ctx.destination);

    onStateChange = tryStart;
    ctx.addEventListener("statechange", onStateChange);
    void ctx.resume().then(tryStart).catch(() => undefined);
  } catch {
    stop();
  }

  const resume = async () => {
    if (stopped || !ctx) return;
    try {
      await ctx.resume();
      tryStart();
    } catch {
      /* ignore */
    }
  };

  return { resume, stop };
}
