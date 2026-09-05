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
  // false = single utterance: recognition stops on its own once the speaker
  // pauses, which is exactly the turn-taking signal a hands-free
  // conversation needs (VoiceMode relies on onEnd meaning "their turn is
  // over"). true = keeps running through pauses, which is what plain
  // dictation into a textarea wants instead (MicButton).
  continuous = true,
): VoiceRecognizer | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognizer = new Ctor();
  recognizer.lang = lang;
  recognizer.continuous = continuous;
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

// Windows ships two very different generations of voices: the legacy SAPI
// ones (robotic) and the newer neural/"Natural" ones, which sound
// dramatically better and are what makes a voice conversation feel like a
// product rather than a screen reader. Both show up in getVoices(), with
// no flag distinguishing them beyond the name, so this picks the best
// available French voice by preferring those markers, falling back to any
// fr voice, then to the browser default.
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const prefix = lang.split("-")[0].toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  if (sameLang.length === 0) return null;
  const preferred = sameLang.find((v) => /natural|neural|online/i.test(v.name));
  return preferred ?? sameLang[0];
}

// Reads text aloud. Cancels whatever utterance is already in progress
// first — without that, rapid consecutive calls (e.g. re-reading while a
// previous read-aloud is still going) would queue up and speak one after
// another instead of interrupting, which reads as broken/laggy rather
// than responsive. `onDone` fires when the utterance finishes or fails —
// VoiceMode uses it to know when it's the user's turn again, which polling
// speechSynthesis.speaking (the only other option) does far less precisely.
export function speak(text: string, lang = "fr-FR", onDone?: () => void): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    onDone?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  if (onDone) {
    utterance.onend = () => onDone();
    utterance.onerror = () => onDone();
  }
  window.speechSynthesis.speak(utterance);
}

// getVoices() is empty on first call in Chromium until the voice list has
// loaded asynchronously — callers that care about voice quality (VoiceMode)
// warm it up on mount so the first spoken reply already uses the good voice
// instead of the default one.
export function primeVoices(): void {
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.getVoices();
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}
