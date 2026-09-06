import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported, isSpeechSynthesisSupported, speak, startListening } from "../voice";
import { isRecordingSupported, startRecording, type AudioRecorder } from "../audioRecorder";
import { openWindowsSettings, transcribeAudio } from "../api";
import { GEMINI_VOICES, speakWithGemini } from "../speech";

// Audio panel — as much a diagnostic as a settings page. "The mic doesn't
// hear me" has three completely different causes that look identical from
// the outside, and each one needs a different fix:
//   1. no device, or the wrong one selected in Windows
//   2. the app never got microphone permission
//   3. device and permission are both fine, but Chromium's speech
//      recognition service is unreachable from an embedded webview
// The live level meter separates 1+2 from 3 definitively: if the bar moves,
// audio is genuinely reaching the app, so any failure after that point is
// the recognition service and not the microphone.
export default function AudioSettings({
  geminiApiKey,
  geminiModel,
  preferredMicrophone,
  onPreferredMicrophoneChange,
  geminiVoice,
  onGeminiVoiceChange,
}: {
  geminiApiKey: string;
  geminiModel: string;
  /** Empty string means "whatever Windows uses by default". */
  preferredMicrophone: string;
  onPreferredMicrophoneChange: (deviceId: string) => void;
  /** Vide = voix du système Windows. */
  geminiVoice: string;
  onGeminiVoiceChange: (voice: string) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [permission, setPermission] = useState<string>("inconnu");
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [recogState, setRecogState] = useState<"idle" | "listening" | "done" | "failed">("idle");
  const [recogError, setRecogError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const [geminiState, setGeminiState] = useState<"idle" | "recording" | "sending">("idle");
  const [geminiHeard, setGeminiHeard] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const geminiRecRef = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    void refreshDevices();
    // Chromium exposes microphone permission through the Permissions API.
    // It is not universally implemented, so a failure here means "unknown",
    // not an error worth showing.
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((status) => {
        setPermission(status.state);
        status.onchange = () => setPermission(status.state);
      })
      .catch(() => setPermission("inconnu"));
    return () => {
      stopMeter();
      // Leaving the page mid-recording used to leave the microphone open
      // with no way to stop it — the Windows mic indicator would stay lit.
      geminiRecRef.current?.cancel();
      geminiRecRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching device while the meter runs used to keep measuring the old
  // one, which is worse than doing nothing: the bar looks authoritative
  // while reporting the wrong microphone.
  useEffect(() => {
    if (!testing) return;
    stopMeter();
    void startMeter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredMicrophone]);

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      setError("Impossible de lister les appareils : " + e);
      setDevices([]);
    }
  }

  function stopMeter() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setLevel(0);
    setTesting(false);
  }

  async function startMeter() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: preferredMicrophone ? { deviceId: { exact: preferredMicrophone } } : true,
      });
      streamRef.current = stream;
      // Device labels stay blank until permission is actually granted, so
      // this is the moment the list becomes readable.
      void refreshDevices();
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      setTesting(true);
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(100, Math.round((peak / 128) * 220)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      setError(
        name === "NotAllowedError"
          ? "Autorisation micro refusée. Vérifie Paramètres Windows > Confidentialité > Microphone > « Autoriser les applications de bureau à accéder au micro »."
          : name === "NotFoundError"
            ? "Aucun micro détecté par Windows."
            : "Impossible d'ouvrir le micro : " + e,
      );
      setTesting(false);
    }
  }

  function testRecognition() {
    setHeard(null);
    setRecogError(null);
    setRecogState("listening");
    const recognizer = startListening(
      (text) => setHeard(text),
      (err) => {
        if (err && err !== "no-speech") {
          setRecogError(err);
          setRecogState("failed");
        } else {
          setRecogState("done");
        }
      },
      "fr-FR",
      false,
    );
    if (!recognizer) {
      setRecogError("indisponible");
      setRecogState("failed");
    }
  }

  // Second, independent path to speech-to-text: record locally, transcribe
  // with Gemini. Worth having because the browser's own recognition can be
  // unavailable in an embedded webview for reasons the app cannot fix.
  async function startGeminiTest() {
    setGeminiHeard(null);
    setGeminiError(null);
    if (!geminiApiKey.trim()) {
      setGeminiError("Ajoute ta clé API Gemini dans Réglages > Extensions > Control Me.");
      return;
    }
    try {
      geminiRecRef.current = await startRecording(preferredMicrophone || undefined);
      setGeminiState("recording");
    } catch (e) {
      setGeminiError("Impossible d'ouvrir le micro : " + e);
    }
  }

  async function stopGeminiTest() {
    const rec = geminiRecRef.current;
    geminiRecRef.current = null;
    if (!rec) return;
    setGeminiState("sending");
    try {
      const audio = await rec.stop();
      if (!audio) {
        setGeminiError("Aucun son enregistré.");
        setGeminiState("idle");
        return;
      }
      const text = await transcribeAudio(geminiApiKey, geminiModel, audio.base64, audio.mimeType);
      setGeminiHeard(text || "(aucune parole détectée)");
    } catch (e) {
      setGeminiError(String(e));
    } finally {
      setGeminiState("idle");
    }
  }

  return (
    <div className="settings-section">
      <h2>Audio</h2>
      <p className="modal-hint">
        Cette page sert aussi de diagnostic. Si la barre de niveau bouge quand tu parles, le son arrive bien à
        l&apos;application — un échec après ça ne vient donc pas du micro.
      </p>

      <label>Autorisation micro</label>
      <div className="audio-status">
        {permission === "granted"
          ? "Accordée"
          : permission === "denied"
            ? "Refusée — l'app ne peut pas écouter"
            : permission === "prompt"
              ? "Pas encore demandée"
              : "Inconnue (non exposée par le moteur)"}
      </div>

      <div className="audio-row">
        <button onClick={() => void openWindowsSettings("microphone-privacy")}>
          Ouvrir la confidentialité micro (Windows)
        </button>
        <button onClick={() => void openWindowsSettings("sound")}>Ouvrir les paramètres son (Windows)</button>
      </div>
      <p className="modal-hint">
        Le micro par défaut se choisit dans Windows, pas ici : la reconnaissance vocale du moteur utilise
        toujours celui du système et n&apos;expose aucun moyen d&apos;en sélectionner un autre.
      </p>

      <label>Appareils d&apos;entrée détectés</label>
      {devices === null ? (
        <div className="audio-status">Chargement…</div>
      ) : devices.length === 0 ? (
        <div className="audio-status">Aucun micro détecté.</div>
      ) : (
        <select value={preferredMicrophone} onChange={(e) => onPreferredMicrophoneChange(e.target.value)}>
          <option value="">Micro par défaut de Windows</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || "Micro " + (i + 1) + " (nom masqué tant que l'autorisation n'est pas accordée)"}
            </option>
          ))}
        </select>
      )}
      <p className="modal-hint">
        Ce choix s&apos;applique au test de niveau et à la transcription par Gemini. La reconnaissance vocale du
        moteur, elle, utilise toujours le micro par défaut de Windows — elle n&apos;expose aucun moyen d&apos;en
        choisir un autre, d&apos;où les boutons ci-dessus.
      </p>
      <button onClick={() => void refreshDevices()}>Rafraîchir la liste</button>

      <label>Niveau du micro</label>
      <div className="audio-meter">
        <div className="audio-meter-fill" style={{ width: level + "%" }} />
      </div>
      <div className="audio-row">
        {testing ? (
          <button onClick={stopMeter}>Arrêter le test</button>
        ) : (
          <button onClick={() => void startMeter()}>Tester le micro</button>
        )}
        <span className="modal-hint">{testing ? "Parle : la barre doit bouger." : "Lance le test puis parle."}</span>
      </div>

      <label>Voix de l'IA</label>
      <select value={geminiVoice} onChange={(e) => onGeminiVoiceChange(e.target.value)}>
        <option value="">Voix du système Windows</option>
        {GEMINI_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <p className="modal-hint">
        Les voix Gemini sont nettement plus naturelles que celles de Windows, mais elles passent par ton
        compte Gemini : chaque réponse lue à voix haute est un appel à l'API, et le texte part chez Google.
      </p>
      <div className="audio-row">
        <button
          disabled={!geminiVoice || !geminiApiKey.trim()}
          onClick={() =>
            void speakWithGemini(
              "Bonjour. Si tu entends cette phrase, la voix Gemini fonctionne.",
              geminiApiKey,
              geminiVoice,
            ).catch((e) => setError(String(e)))
          }
        >
          Essayer cette voix
        </button>
        <span className="modal-hint">
          {geminiApiKey.trim() ? "Nécessite ta clé Gemini." : "Ajoute ta clé Gemini pour utiliser ces voix."}
        </span>
      </div>

      <label>Reconnaissance vocale</label>
      <div className="audio-status">
        {isSpeechRecognitionSupported() ? "Disponible dans ce moteur" : "Non disponible dans ce moteur"}
      </div>
      <div className="audio-row">
        <button onClick={testRecognition} disabled={recogState === "listening"}>
          {recogState === "listening" ? "Parle maintenant…" : "Tester la reconnaissance"}
        </button>
        {isSpeechSynthesisSupported() && (
          <button onClick={() => speak("Test de la voix de sortie. Si tu entends ceci, la synthèse fonctionne.")}>
            Tester la voix de sortie
          </button>
        )}
      </div>
      {heard && <div className="audio-status">Entendu : « {heard} »</div>}
      {recogState === "done" && !heard && <div className="audio-status">Rien n&apos;a été transcrit.</div>}
      {recogError && (
        <div className="banner banner-error">
          {recogError === "network"
            ? "La reconnaissance n'a pas pu joindre son service. C'est le service de transcription qui est en cause, pas ton micro — si la barre de niveau bouge, le matériel et l'autorisation sont bons."
            : recogError === "not-allowed" || recogError === "service-not-allowed"
              ? "Le micro est bloqué pour l'application. Ferme-la complètement et rouvre-la, puis vérifie Paramètres Windows > Confidentialité > Microphone."
              : recogError === "audio-capture"
                ? "Aucun micro accessible."
                : "Échec de la reconnaissance (" + recogError + ")."}
        </div>
      )}

      {isRecordingSupported() && (
        <>
          <label>Transcription de secours (Gemini)</label>
          <p className="modal-hint">
            Chemin indépendant : l&apos;audio est enregistré ici puis transcrit par Gemini. Utile si la
            reconnaissance du moteur échoue avec une erreur réseau, ce que l&apos;application ne peut pas corriger
            de son côté. Nécessite ta clé API Gemini.
          </p>
          <div className="audio-row">
            {geminiState === "recording" ? (
              <button onClick={() => void stopGeminiTest()}>Arrêter et transcrire</button>
            ) : (
              <button onClick={() => void startGeminiTest()} disabled={geminiState === "sending"}>
                {geminiState === "sending" ? "Transcription…" : "Enregistrer puis transcrire"}
              </button>
            )}
            <span className="modal-hint">
              {geminiState === "recording" ? "Parle, puis clique sur Arrêter." : "Teste le chemin de secours."}
            </span>
          </div>
          {geminiHeard && <div className="audio-status">Transcrit : « {geminiHeard} »</div>}
          {geminiError && <div className="banner banner-error">{geminiError}</div>}
        </>
      )}

      {error && <div className="banner banner-error">{error}</div>}
    </div>
  );
}
