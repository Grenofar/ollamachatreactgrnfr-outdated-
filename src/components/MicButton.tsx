import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported, startListening, type VoiceRecognizer } from "../voice";

// Shared between the base chat and Control Me — a mic toggle that
// live-fills whatever text the caller's input currently holds. Renders
// nothing if the browser doesn't support SpeechRecognition at all, rather
// than a button that would just fail silently on click.
export default function MicButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<VoiceRecognizer | null>(null);

  useEffect(() => {
    return () => recognizerRef.current?.stop();
  }, []);

  if (!isSpeechRecognitionSupported()) return null;

  function toggle() {
    if (listening) {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }
    setError(null);
    const recognizer = startListening(
      (text) => onTranscript(text),
      (err) => {
        setListening(false);
        recognizerRef.current = null;
        // Without this the button just flicked back off and the user was
        // left guessing why nothing was transcribed.
        if (err && err !== "no-speech" && err !== "aborted") {
          setError(
            err === "not-allowed" || err === "service-not-allowed"
              ? "Micro bloqué : ferme et rouvre l'app."
              : err === "audio-capture"
                ? "Aucun micro détecté."
                : `Micro indisponible (${err}).`,
          );
        }
      },
    );
    if (recognizer) {
      recognizerRef.current = recognizer;
      setListening(true);
    } else {
      setError("Impossible de démarrer la reconnaissance vocale.");
    }
  }

  return (
    <button
      type="button"
      className={`mic-btn ${listening ? "mic-btn-listening" : ""} ${error ? "mic-btn-error" : ""}`}
      onClick={toggle}
      disabled={disabled}
      title={error ?? (listening ? "Arrêter l'écoute" : "Dicter à la voix")}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <line x1="12" y1="18" x2="12" y2="22" />
      </svg>
    </button>
  );
}
