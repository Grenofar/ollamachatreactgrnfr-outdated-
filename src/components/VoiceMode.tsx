import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported, primeVoices, speak, startListening, stopSpeaking, type VoiceRecognizer } from "../voice";

type VoiceState = "listening" | "thinking" | "speaking";

// Hands-free voice conversation, deliberately replacing the transcript view
// rather than sitting next to it: while this is open the app shows two
// participants talking, not a chat log. Shared by the base chat and Control
// Me — it knows nothing about either, it just hands finished utterances up
// (`onUserMessage`) and speaks whatever reply comes back down (`reply`).
export default function VoiceMode({
  title,
  subtitle,
  assistantName,
  busy,
  reply,
  onUserMessage,
  onClose,
}: {
  title: string;
  subtitle?: string;
  assistantName: string;
  /** Parent is currently generating — drives the "thinking" state. */
  busy: boolean;
  /** Latest assistant reply. Spoken once, when it changes to a new value. */
  reply: string | null;
  onUserMessage: (text: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<VoiceState>("listening");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<VoiceRecognizer | null>(null);
  const transcriptRef = useRef("");
  const spokenRef = useRef<string | null>(null);
  const closedRef = useRef(false);

  // Kept in a ref so the recognizer's onEnd closure (created once per
  // listening turn) always calls the current parent handler rather than the
  // one captured when that turn started.
  const onUserMessageRef = useRef(onUserMessage);
  useEffect(() => {
    onUserMessageRef.current = onUserMessage;
  });

  function beginListening() {
    if (closedRef.current) return;
    transcriptRef.current = "";
    setCaption("");
    setState("listening");
    const recognizer = startListening(
      (text) => {
        transcriptRef.current = text;
        setCaption(text);
      },
      () => {
        recognizerRef.current = null;
        const said = transcriptRef.current.trim();
        if (closedRef.current) return;
        if (said) {
          setState("thinking");
          onUserMessageRef.current(said);
        } else {
          // Nothing said before the pause — just listen again rather than
          // handing an empty turn to the model.
          beginListening();
        }
      },
      "fr-FR",
      // Single-utterance: recognition ending IS the "your turn is over"
      // signal that makes hands-free turn-taking work.
      false,
    );
    if (!recognizer) {
      setError("La reconnaissance vocale n'a pas pu démarrer.");
      return;
    }
    recognizerRef.current = recognizer;
  }

  useEffect(() => {
    primeVoices();
    if (!isSpeechRecognitionSupported()) {
      setError("La reconnaissance vocale n'est pas disponible sur cette machine.");
      return;
    }
    beginListening();
    return () => {
      closedRef.current = true;
      recognizerRef.current?.stop();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak each new reply once, then hand the turn back to the user.
  useEffect(() => {
    if (closedRef.current || busy) return;
    if (reply && reply !== spokenRef.current) {
      spokenRef.current = reply;
      setState("speaking");
      setCaption(reply);
      speak(stripForSpeech(reply), "fr-FR", () => {
        if (!closedRef.current) beginListening();
      });
      return;
    }
    // Waiting on a reply that never came — the turn was dropped (a run was
    // already in flight, or it failed). Without this the orb would sit on
    // "Réflexion…" forever with the microphone off, and the conversation
    // would be silently dead.
    if (state === "thinking") beginListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, busy]);

  const stateLabel =
    state === "listening" ? "À toi de parler…" : state === "thinking" ? "Réflexion…" : `${assistantName} parle…`;

  return (
    <div className="voice-mode">
      <div className="voice-mode-header">
        <div>
          <div className="voice-mode-title">{title}</div>
          {subtitle && <div className="voice-mode-subtitle">{subtitle}</div>}
        </div>
        <button className="voice-mode-close" onClick={onClose}>
          Terminer
        </button>
      </div>

      <div className="voice-mode-stage">
        <div className={`voice-participant ${state === "listening" ? "voice-participant-active" : ""}`}>
          <div className="voice-avatar voice-avatar-user">Toi</div>
          <span>{state === "listening" ? "en train de parler" : "en attente"}</span>
        </div>

        <div className={`voice-orb voice-orb-${state}`}>
          <span className="voice-orb-ring" />
          <span className="voice-orb-ring" />
          <span className="voice-orb-core" />
        </div>

        <div className={`voice-participant ${state !== "listening" ? "voice-participant-active" : ""}`}>
          <div className="voice-avatar voice-avatar-ai">IA</div>
          <span>{state === "thinking" ? "réfléchit" : state === "speaking" ? "répond" : "écoute"}</span>
        </div>
      </div>

      <div className="voice-mode-state">{error ?? stateLabel}</div>
      <div className="voice-mode-caption">{caption}</div>

      {state === "speaking" && (
        <button
          className="voice-mode-skip"
          onClick={() => {
            stopSpeaking();
            beginListening();
          }}
        >
          Passer et reprendre la parole
        </button>
      )}
    </div>
  );
}

// Markdown read aloud literally ("astérisque astérisque") is unbearable in
// a voice conversation, and code blocks are worse — dropped entirely rather
// than dictated character by character.
function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (bloc de code) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_#>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
