import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported, primeVoices, speak, startListening, stopSpeaking, type VoiceRecognizer } from "../voice";
import { isRecordingSupported, startRecording, startVoiceTurn, type AudioRecorder, type VoiceTurn } from "../audioRecorder";
import { transcribeAudio } from "../api";
import { speakWithGemini, stopGeminiSpeech } from "../speech";
import { isLiveSupported, startLiveSession, type LiveSession } from "../liveVoice";

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
  geminiApiKey,
  geminiModel,
  geminiVoice,
  micDeviceId,
  liveMode,
  liveInstruction,
  liveModel,
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
  /** Enables the push-to-talk fallback when browser recognition is out. */
  geminiApiKey?: string;
  geminiModel?: string;
  /** Voix Gemini à utiliser ; vide = voix du système. */
  geminiVoice?: string;
  micDeviceId?: string;
  /** Conversation temps réel : une seule connexion, l'IA entend
   * pendant qu'on parle au lieu d'attendre la fin. */
  liveMode?: boolean;
  /** Consigne donnée au modèle temps réel. */
  liveInstruction?: string;
  /** Identifiant du modèle Live ; vide = celui par défaut. */
  liveModel?: string;
}) {
  const [state, setState] = useState<VoiceState>("listening");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Fallback so a broken microphone degrades the conversation instead of
  // ending it: the assistant keeps speaking its replies, only the input
  // side falls back to typing.
  const [typed, setTyped] = useState("");
  const deaf = error !== null;
  const recognizerRef = useRef<VoiceRecognizer | null>(null);
  const transcriptRef = useRef("");
  const spokenRef = useRef<string | null>(null);
  const closedRef = useRef(false);
  const failuresRef = useRef(0);
  const deafRef = useRef(false);
  const [pushState, setPushState] = useState<"idle" | "recording" | "sending">("idle");
  // Kept separate from `error`: that one means "recognition is down for
  // good" and drives the deaf state, so reusing it for a transient
  // push-to-talk failure would latch the UI into deaf mode permanently,
  // even though recognition itself was fine.
  const [pushError, setPushError] = useState<string | null>(null);
  const pushRecRef = useRef<AudioRecorder | null>(null);
  const turnRef = useRef<VoiceTurn | null>(null);
  const usingGeminiEars = useRef(false);
  const liveRef = useRef<LiveSession | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const canPushToTalk = !!geminiApiKey?.trim() && isRecordingSupported();

  // Kept in a ref so the recognizer's onEnd closure (created once per
  // listening turn) always calls the current parent handler rather than the
  // one captured when that turn started.
  const onUserMessageRef = useRef(onUserMessage);
  useEffect(() => {
    onUserMessageRef.current = onUserMessage;
  });

  // Quand la reconnaissance du navigateur ne répond pas, on écoute nous-
  // mêmes : enregistrement + détection de fin de parole, puis transcription
  // par Gemini. La conversation reste mains libres, sans dépendre d'un
  // service que l'app ne contrôle pas.
  async function beginGeminiTurn() {
    if (closedRef.current) return;
    usingGeminiEars.current = true;
    setState("listening");
    setCaption("");
    try {
      turnRef.current = await startVoiceTurn({
        deviceId: micDeviceId || undefined,
        onSpeechStart: () => setCaption("…"),
        onTurnEnd: (rec) => {
          turnRef.current = null;
          if (closedRef.current) return;
          if (!rec) {
            // Rien dit : on relance sans rien envoyer.
            void beginGeminiTurn();
            return;
          }
          setState("thinking");
          transcribeAudio(geminiApiKey ?? "", geminiModel ?? "", rec.base64, rec.mimeType)
            .then((text) => {
              const said = text.trim();
              if (closedRef.current) return;
              if (!said) {
                void beginGeminiTurn();
                return;
              }
              setCaption(said);
              onUserMessageRef.current(said);
            })
            .catch((e) => {
              if (closedRef.current) return;
              setPushError("Transcription impossible : " + e);
              void beginGeminiTurn();
            });
        },
      });
    } catch (e) {
      markDeaf("Le micro n'a pas pu être ouvert : " + e);
    }
  }

  function markDeaf(message: string) {
    // Si une clé Gemini est disponible, on ne devient pas sourd : on change
    // simplement de façon d'écouter. C'est le vrai correctif du "l'IA ne
    // m'entend pas" — la permission WebView2 seule n'y suffisait pas.
    if (canPushToTalk && !deafRef.current) {
      void beginGeminiTurn();
      return;
    }
    deafRef.current = true;
    setError(message);
    setState("listening");
    // The whole point of voice mode is that the assistant talks to you, so
    // it says why it went quiet instead of leaving a silent orb on screen.
    speak(message, "fr-FR");
  }

  function beginListening() {
    if (closedRef.current || deafRef.current) return;
    transcriptRef.current = "";
    setCaption("");
    setState("listening");
    const recognizer = startListening(
      (text) => {
        transcriptRef.current = text;
        setCaption(text);
      },
      (error) => {
        recognizerRef.current = null;
        const said = transcriptRef.current.trim();
        if (closedRef.current) return;
        if (said) {
          failuresRef.current = 0;
          setState("thinking");
          onUserMessageRef.current(said);
          return;
        }
        // "no-speech" just means the pause was silent — that is normal and
        // should not count as a failure. Anything else is a real problem
        // (blocked microphone, no audio device, recognition service
        // unreachable) and must be surfaced instead of silently retried
        // forever, which is what the first version did.
        if (error && error !== "no-speech" && error !== "aborted") {
          failuresRef.current += 1;
          if (failuresRef.current >= 3) {
            markDeaf(describeVoiceError(error));
            return;
          }
        }
        beginListening();
      },
      "fr-FR",
      // Single-utterance: recognition ending IS the "your turn is over"
      // signal that makes hands-free turn-taking work.
      false,
    );
    if (!recognizer) {
      markDeaf("La reconnaissance vocale n'a pas pu démarrer. Écris-moi et je continue à te répondre à voix haute.");
      return;
    }
    recognizerRef.current = recognizer;
  }

  useEffect(() => {
    primeVoices();
    // Mode temps réel : une seule connexion tient toute la conversation,
    // donc ni reconnaissance du navigateur, ni tour de parole à orchestrer
    // ici — le modèle entend pendant qu'on parle et répond en continu.
    if (liveMode && geminiApiKey?.trim() && isLiveSupported()) {
      setLiveOn(true);
      setState("listening");
      startLiveSession({
        apiKey: geminiApiKey,
        model: liveModel || undefined,
        voice: geminiVoice || undefined,
        systemInstruction: liveInstruction,
        deviceId: micDeviceId || undefined,
        onSpeakingChange: (speaking) => {
          if (!closedRef.current) setState(speaking ? "speaking" : "listening");
        },
        onTranscript: (text) => {
          if (!closedRef.current) setCaption(text);
        },
        onError: (message) => {
          if (!closedRef.current) setPushError(message);
        },
      })
        .then((session) => {
          if (closedRef.current) session.close();
          else liveRef.current = session;
        })
        .catch((e) => {
          if (closedRef.current) return;
          setLiveOn(false);
          // Retour au mode par tours plutôt que d'abandonner la conversation.
          markDeaf("Le mode temps réel n'a pas pu démarrer : " + e);
        });
      return () => {
        closedRef.current = true;
        liveRef.current?.close();
        liveRef.current = null;
      };
    }
    // Note the cleanup below is returned in BOTH branches: an early return
    // here would skip it entirely, leaving the assistant still speaking
    // after the user closed voice mode.
    if (!isSpeechRecognitionSupported()) {
      markDeaf("La reconnaissance vocale n'est pas disponible sur cette machine. Écris-moi et je continue à te répondre à voix haute.");
    } else {
      beginListening();
    }
    return () => {
      closedRef.current = true;
      recognizerRef.current?.stop();
      // Same leak as in AudioSettings: closing voice mode while a
      // push-to-talk recording was running left the microphone open.
      pushRecRef.current?.cancel();
      pushRecRef.current = null;
      turnRef.current?.cancel();
      turnRef.current = null;
      stopGeminiSpeech();
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
      const spoken = stripForSpeech(reply);
      const handBack = () => {
        if (closedRef.current) return;
        // Trois façons de rendre la parole selon la manière dont on écoute :
        // reconnaissance du navigateur, écoute Gemini, ou clavier seul.
        if (deafRef.current) setState("listening");
        else if (usingGeminiEars.current) void beginGeminiTurn();
        else beginListening();
      };
      // Voix Gemini si elle est configurée ; sinon celle du système. En cas
      // d'échec on retombe sur le système plutôt que de rester muet : une
      // réponse dite d'une voix moins belle vaut mieux qu'une réponse muette.
      if (geminiVoice && geminiApiKey?.trim()) {
        speakWithGemini(spoken, geminiApiKey, geminiVoice, handBack).catch(() => {
          speak(spoken, "fr-FR", handBack);
        });
      } else {
        speak(spoken, "fr-FR", handBack);
      }
      return;
    }
    // Waiting on a reply that never came — the turn was dropped (a run was
    // already in flight, or it failed). Without this the orb would sit on
    // "Réflexion…" forever with the microphone off, and the conversation
    // would be silently dead.
    if (state === "thinking") {
      if (deafRef.current) setState("listening");
      else beginListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, busy]);

  // Push-to-talk through Gemini: when the browser's own recognition is out,
  // this is a second, independent way to be heard, so voice mode stays a
  // conversation instead of degrading to typing only.
  async function startPush() {
    try {
      pushRecRef.current = await startRecording();
      setPushState("recording");
      setCaption("");
    } catch (e) {
      setPushError("Impossible d'ouvrir le micro : " + e);
    }
  }

  async function stopPush() {
    const rec = pushRecRef.current;
    pushRecRef.current = null;
    if (!rec) return;
    setPushState("sending");
    try {
      const audio = await rec.stop();
      if (!audio) {
        setPushState("idle");
        return;
      }
      const text = (await transcribeAudio(geminiApiKey ?? "", geminiModel ?? "", audio.base64, audio.mimeType)).trim();
      setPushState("idle");
      if (!text) return;
      setCaption(text);
      setState("thinking");
      onUserMessageRef.current(text);
    } catch (e) {
      setPushState("idle");
      setPushError("La transcription a échoué : " + e);
    }
  }

  const stateLabel = liveOn
    ? state === "speaking"
      ? `${assistantName} répond…`
      : "Parle quand tu veux, elle écoute en continu"
    :
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

      {deaf && canPushToTalk && (
        <div className="audio-row voice-mode-push">
          {pushState === "recording" ? (
            <button onClick={() => void stopPush()}>Terminé — envoyer</button>
          ) : (
            <button onClick={() => void startPush()} disabled={pushState === "sending" || busy}>
              {pushState === "sending" ? "Transcription…" : "Appuyer pour parler"}
            </button>
          )}
          <span className="modal-hint">
            {pushError ?? "Passe par Gemini, puisque la reconnaissance du moteur ne répond pas."}
          </span>
        </div>
      )}

      {deaf && (
        <form
          className="voice-mode-fallback"
          onSubmit={(e) => {
            e.preventDefault();
            const said = typed.trim();
            if (!said || busy) return;
            setTyped("");
            setCaption(said);
            setState("thinking");
            onUserMessageRef.current(said);
          }}
        >
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Écris ici — la réponse sera dite à voix haute"
          />
          <button type="submit" disabled={busy || !typed.trim()}>
            Envoyer
          </button>
        </form>
      )}

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

// Turns a SpeechRecognition error code into something that tells the user
// what to actually do — the codes themselves ("not-allowed") never reach
// anyone useful otherwise.
function describeVoiceError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Le micro est bloqué pour l'app. Ferme-la complètement et rouvre-la : cette version demande l'autorisation automatiquement.";
    case "audio-capture":
      return "Aucun micro détecté. Vérifie qu'un micro est branché et sélectionné dans les réglages son de Windows.";
    case "network":
      return "La reconnaissance vocale n'a pas pu joindre son service (elle passe par le réseau). Vérifie ta connexion.";
    default:
      return `La reconnaissance vocale s'est arrêtée (${code}).`;
  }
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
