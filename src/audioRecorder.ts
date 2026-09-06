// Records a short utterance with MediaRecorder so it can be transcribed by
// Gemini instead of the browser's own speech recognition. This exists
// because that recognition depends on a Google service whose key ships only
// with branded browsers, so in an embedded webview it can fail with a
// "network" error that the page cannot recover from — see voice.ts and the
// Audio settings panel, which is what tells the two cases apart.
//
// MediaRecorder's default in this webview is audio/webm;codecs=opus, and
// audio/webm is one of the container types the Gemini Interactions API
// accepts for inline audio (verified against its documented list rather
// than assumed), so no re-encoding is needed.

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export interface Recording {
  /** Base64 (no data: prefix) — what the Rust command expects. */
  base64: string;
  /** Container type only, e.g. "audio/webm" — the codec parameter is dropped
   * because the API keys off the container. */
  mimeType: string;
  bytes: number;
}

export interface AudioRecorder {
  /** Resolves with the recording, or null if nothing was captured. */
  stop(): Promise<Recording | null>;
  /** Discards the recording and releases the microphone. */
  cancel(): void;
}

export async function startRecording(deviceId?: string): Promise<AudioRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });

  // Pick the first type this build actually supports rather than trusting a
  // single hard-coded string: isTypeSupported is the only reliable check,
  // and an unsupported type makes the constructor throw.
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported(t));

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop() {
      return new Promise<Recording | null>((resolve) => {
        if (recorder.state === "inactive") {
          release();
          resolve(null);
          return;
        }
        recorder.onstop = async () => {
          release();
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const buffer = await blob.arrayBuffer();
          resolve({
            base64: bytesToBase64(new Uint8Array(buffer)),
            mimeType: (recorder.mimeType || "audio/webm").split(";")[0],
            bytes: buffer.byteLength,
          });
        };
        recorder.stop();
      });
    },
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}

// btoa on a huge spread argument blows the call-stack limit, so this walks
// the buffer in chunks — a few seconds of opus is small, but a long
// utterance is not, and the failure would be silent and confusing.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

// Écoute mains libres qui ne dépend pas du tout de SpeechRecognition :
// on enregistre, on surveille le niveau sonore, et on s'arrête quand la
// personne a parlé puis s'est tue. C'est ce qui permet à une conversation
// vocale de fonctionner même quand la reconnaissance du navigateur est
// injoignable — le cas signalé de façon répétée, et que la permission
// WebView2 seule ne corrige pas.
export interface VoiceTurn {
  /** Arrête l'écoute immédiatement et rend ce qui a été capté. */
  finish(): Promise<Recording | null>;
  cancel(): void;
}

export interface VoiceTurnOptions {
  deviceId?: string;
  /** Appelé quand un silence a suivi de la parole : le tour est fini. */
  onTurnEnd: (recording: Recording | null) => void;
  /** Appelé au premier son au-dessus du seuil, pour l'affichage. */
  onSpeechStart?: () => void;
  /** Niveau instantané 0-100, pour animer. */
  onLevel?: (level: number) => void;
}

const SILENCE_LEVEL = 6; // en dessous, on considère que personne ne parle
const SILENCE_MS = 1200; // silence à tenir après la parole pour clore le tour
const MAX_TURN_MS = 30000; // garde-fou : un micro ouvert ne l'est pas sans fin
const NO_SPEECH_TIMEOUT_MS = 12000; // rien n'a été dit du tout

export async function startVoiceTurn(options: VoiceTurnOptions): Promise<VoiceTurn> {
  const recorder = await startRecording(options.deviceId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: options.deviceId ? { deviceId: { exact: options.deviceId } } : true,
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);

  let raf: number | null = null;
  let spoke = false;
  let silenceSince: number | null = null;
  let done = false;
  const startedAt = Date.now();

  const cleanup = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  const conclude = async () => {
    if (done) return;
    done = true;
    cleanup();
    options.onTurnEnd(await recorder.stop());
  };

  const tick = () => {
    if (done) return;
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128));
    const level = Math.min(100, Math.round((peak / 128) * 220));
    options.onLevel?.(level);

    const elapsed = Date.now() - startedAt;
    if (level > SILENCE_LEVEL) {
      if (!spoke) {
        spoke = true;
        options.onSpeechStart?.();
      }
      silenceSince = null;
    } else if (spoke) {
      silenceSince ??= Date.now();
      if (Date.now() - silenceSince >= SILENCE_MS) {
        void conclude();
        return;
      }
    }
    // Deux fins distinctes : "tu n'as rien dit" (on rend null, l'appelant
    // relance) et "tu parles depuis trop longtemps" (on garde ce qui a été
    // dit plutôt que de le jeter).
    if (!spoke && elapsed > NO_SPEECH_TIMEOUT_MS) {
      done = true;
      cleanup();
      recorder.cancel();
      options.onTurnEnd(null);
      return;
    }
    if (elapsed > MAX_TURN_MS) {
      void conclude();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    async finish() {
      if (done) return null;
      done = true;
      cleanup();
      return recorder.stop();
    },
    cancel() {
      if (done) return;
      done = true;
      cleanup();
      recorder.cancel();
    },
  };
}
