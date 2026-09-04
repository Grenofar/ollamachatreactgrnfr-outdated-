// Voice input/output for Chat and Control Me — built entirely on the
// browser's native Web Speech API (SpeechRecognition + SpeechSynthesis),
// no added dependency. Verified before writing this: on Windows,
// Tauri's WebView2 is Chromium-based and both parts of the API "should
// just work" there (unlike Linux/webkitgtk, irrelevant to this
// Windows-only project). TypeScript's bundled DOM lib doesn't ship types
// for SpeechRecognition (still non-standard), so the minimal shapes used
// here are declared by hand instead of adding a @types package.

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface VoiceRecognizer {
  stop(): void;
}

// Starts listening immediately. `onTranscript` fires repeatedly with the
// best-effort transcript so far (interim results included) — the caller
// decides what to do with partial text (this project just live-fills the
// textarea, same feel as ChatGPT/Gemini's voice mode). `onEnd` fires once
// recognition stops, whether the user stopped it, it stopped itself after
// silence, or an error occurred — the caller doesn't need to distinguish
// those to update its own "listening" UI state.
export function startListening(
  onTranscript: (text: string, isFinal: boolean) => void,
  onEnd: () => void,
  lang = "fr-FR",
): VoiceRecognizer | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognizer = new Ctor();
  recognizer.lang = lang;
  recognizer.continuous = true;
  recognizer.interimResults = true;

  recognizer.onresult = (event) => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    const lastResult = event.results[event.results.length - 1];
    onTranscript(text, lastResult?.isFinal ?? false);
  };
  recognizer.onerror = () => onEnd();
  recognizer.onend = () => onEnd();

  try {
    recognizer.start();
  } catch {
    return null;
  }
  return {
    stop() {
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      recognizer.stop();
    },
  };
}

// Reads text aloud. Cancels whatever utterance is already in progress
// first — without that, rapid consecutive calls (e.g. re-reading while a
// previous read-aloud is still going) would queue up and speak one after
// another instead of interrupting, which reads as broken/laggy rather
// than responsive.
export function speak(text: string, lang = "fr-FR"): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}
