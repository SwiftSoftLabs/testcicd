type BrowserSpeechRecognition = SpeechRecognition;

function getSpeechRecognitionCtor():
  | (new () => BrowserSpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export type BrowserSpeechSession = {
  stop: () => Promise<string>;
  abort: () => void;
};

export function startBrowserSpeechSession(opts: {
  onPartialTranscript: (text: string) => void;
}): BrowserSpeechSession | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  let finalText = "";
  let interimText = "";
  let aborted = false;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language?.trim() || "en-US";

  const emit = () => {
    const combined = `${finalText}${interimText}`.trim();
    if (combined) opts.onPartialTranscript(combined);
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const part = event.results[i]?.[0]?.transcript ?? "";
      if (event.results[i]?.isFinal) {
        finalText += part;
      } else {
        interim += part;
      }
    }
    interimText = interim;
    emit();
  };

  recognition.onerror = () => {
    /* Browser STT is best-effort; MediaRecorder remains the fallback. */
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    abort: () => {
      aborted = true;
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    },
    stop: () =>
      new Promise<string>((resolve) => {
        if (aborted) {
          resolve("");
          return;
        }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(aborted ? "" : `${finalText}${interimText}`.trim());
        };

        recognition.onend = () => {
          window.setTimeout(finish, 300);
        };

        try {
          recognition.stop();
        } catch {
          finish();
        }

        window.setTimeout(finish, 900);
      }),
  };
}
