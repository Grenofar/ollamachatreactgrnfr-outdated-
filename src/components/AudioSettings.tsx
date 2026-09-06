import { useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported, isSpeechSynthesisSupported, speak, startListening } from "../voice";

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
export default function AudioSettings() {
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
    return () => stopMeter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      <label>Appareils d&apos;entrée détectés</label>
      {devices === null ? (
        <div className="audio-status">Chargement…</div>
      ) : devices.length === 0 ? (
        <div className="audio-status">Aucun micro détecté.</div>
      ) : (
        <div className="audio-device-list">
          {devices.map((d, i) => (
            <div key={d.deviceId || i} className="audio-device">
              {d.label || "Micro " + (i + 1) + " (nom masqué tant que l'autorisation n'est pas accordée)"}
            </div>
          ))}
        </div>
      )}
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

      {error && <div className="banner banner-error">{error}</div>}
    </div>
  );
}
