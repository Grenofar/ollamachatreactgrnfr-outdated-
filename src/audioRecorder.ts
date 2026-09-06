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
