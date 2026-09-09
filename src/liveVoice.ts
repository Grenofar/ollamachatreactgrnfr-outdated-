// Conversation vocale en temps réel via le Live API de Gemini.
//
// Pourquoi ça change tout par rapport au mode vocal précédent : celui-ci
// enchaînait enregistrer → attendre le silence → transcrire → générer →
// synthétiser, soit quatre allers-retours avant d'entendre une réponse.
// Le Live API tient une seule connexion WebSocket ouverte, reçoit l'audio
// au fil de l'eau et renvoie de l'audio au fil de l'eau. Le modèle entend
// pendant qu'on parle, au lieu d'attendre qu'on ait fini.
//
// Protocole vérifié dans la documentation officielle avant d'écrire, pas
// supposé — en particulier les deux fréquences d'échantillonnage, qui ne
// sont pas les mêmes dans les deux sens et qu'il serait facile de croire
// identiques : **16 kHz en entrée, 24 kHz en sortie**, PCM 16 bits mono
// little-endian des deux côtés.

const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// Modèles Live vus dans la console de quotas de l'utilisateur, où ils
// affichent "Illimité" en requêtes (avec un plafond de jetons, indiqué
// ici). Les identifiants sont déduits des noms affichés : la console
// montre des libellés, pas des ids. D'où le champ libre côté Réglages,
// pour corriger sans attendre une nouvelle version si l'un d'eux ne
// correspond pas.
export const LIVE_MODELS = [
  { id: "gemini-3-flash-live", label: "Gemini 3 Flash Live — illimité en requêtes (65K jetons)" },
  {
    id: "gemini-2.5-flash-native-audio-dialog",
    label: "Gemini 2.5 Flash Native Audio Dialog — illimité en requêtes (1M jetons)",
  },
  { id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (preview) — facturé à l'audio" },
];

export const LIVE_MODEL = LIVE_MODELS[0].id;

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
/** Taille de bloc du capteur. Plus petit = moins de latence, mais plus de
 * messages ; 4096 à 48 kHz fait ~85 ms, un bon compromis. */
const CAPTURE_CHUNK = 4096;

export interface LiveSessionOptions {
  apiKey: string;
  /** Identifiant du modèle Live. Vide = LIVE_MODEL. */
  model?: string;
  /** Voix Gemini (Kore, Puck…). Vide = voix par défaut du modèle. */
  voice?: string;
  systemInstruction?: string;
  deviceId?: string;
  /** Le modèle a commencé à répondre. */
  onSpeakingChange?: (speaking: boolean) => void;
  /** Niveau du micro 0-100, pour l'affichage. */
  onLevel?: (level: number) => void;
  /** Transcription de ce qui est dit, quand le modèle en fournit une. */
  onTranscript?: (text: string, fromUser: boolean) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface LiveSession {
  close(): void;
  /** Envoie un message texte dans la même conversation. */
  sendText(text: string): void;
}

export function isLiveSupported(): boolean {
  return typeof WebSocket !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export async function startLiveSession(options: LiveSessionOptions): Promise<LiveSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
      // Sans ces trois-là, le modèle s'entend lui-même dans les haut-parleurs
      // et se coupe la parole en boucle.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(options.apiKey)}`);
  const captureCtx = new AudioContext();
  const playCtx = new AudioContext({ sampleRate: OUTPUT_RATE });

  let closed = false;
  let nextPlayAt = 0;
  const sources: AudioBufferSourceNode[] = [];

  const cleanup = () => {
    if (closed) return;
    closed = true;
    stream.getTracks().forEach((t) => t.stop());
    void captureCtx.close();
    stopPlayback();
    void playCtx.close();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  function stopPlayback() {
    // Sur interruption, il ne suffit pas d'arrêter d'ajouter : ce qui est
    // déjà programmé continuerait de jouer par-dessus la nouvelle réponse.
    while (sources.length) {
      try {
        sources.pop()?.stop();
      } catch {
        // déjà terminée
      }
    }
    nextPlayAt = 0;
    options.onSpeakingChange?.(false);
  }

  ws.onopen = () => {
    const speechConfig = options.voice
      ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } }
      : undefined;
    ws.send(
      JSON.stringify({
        setup: {
          model: `models/${options.model?.trim() || LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            ...(speechConfig ? { speechConfig } : {}),
          },
          ...(options.systemInstruction
            ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
            : {}),
        },
      }),
    );
    startCapture();
  };

  ws.onerror = () => {
    options.onError?.("La connexion vocale temps réel a échoué.");
  };

  ws.onclose = (event) => {
    // 1008/1011 accompagnent typiquement une clé refusée ou un modèle
    // indisponible : le dire, plutôt que de fermer sans un mot.
    if (!closed && event.code !== 1000) {
      options.onError?.(
        event.reason?.trim()
          ? `Connexion vocale fermée : ${event.reason}`
          : `Connexion vocale fermée (code ${event.code}).`,
      );
    }
    cleanup();
    options.onClose?.();
  };

  ws.onmessage = async (event) => {
    // Les réponses arrivent en Blob binaire dans un navigateur, pas en
    // texte — les traiter comme des chaînes ne donnerait rien.
    const raw = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handleServerMessage(msg);
  };

  function handleServerMessage(msg: Record<string, unknown>) {
    const server = msg.serverContent as
      | {
          modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string }; text?: string }[] };
          turnComplete?: boolean;
          interrupted?: boolean;
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
        }
      | undefined;
    if (!server) return;

    if (server.interrupted) {
      stopPlayback();
      return;
    }
    if (server.inputTranscription?.text) options.onTranscript?.(server.inputTranscription.text, true);
    if (server.outputTranscription?.text) options.onTranscript?.(server.outputTranscription.text, false);

    for (const part of server.modelTurn?.parts ?? []) {
      if (part.text) options.onTranscript?.(part.text, false);
      const data = part.inlineData?.data;
      if (data) enqueueAudio(data);
    }
    if (server.turnComplete) options.onSpeakingChange?.(false);
  }

  function enqueueAudio(base64: string) {
    const bytes = base64ToBytes(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = playCtx.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

    const source = playCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playCtx.destination);
    // Les morceaux sont mis bout à bout sur l'horloge audio plutôt que
    // joués dès réception : sinon ils se chevauchent et la voix hache.
    const startAt = Math.max(playCtx.currentTime, nextPlayAt);
    source.start(startAt);
    nextPlayAt = startAt + buffer.duration;
    sources.push(source);
    source.onended = () => {
      const i = sources.indexOf(source);
      if (i >= 0) sources.splice(i, 1);
    };
    options.onSpeakingChange?.(true);
  }

  function startCapture() {
    const source = captureCtx.createMediaStreamSource(stream);
    // ScriptProcessorNode est déprécié au profit d'AudioWorklet, mais celui-ci
    // exige un module chargé depuis une URL séparée — une complication de
    // bundling réelle pour un gain nul ici, où le traitement se résume à
    // recopier et convertir un tampon.
    const processor = captureCtx.createScriptProcessor(CAPTURE_CHUNK, 1, 1);
    source.connect(processor);
    processor.connect(captureCtx.destination);

    processor.onaudioprocess = (e) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      let peak = 0;
      for (const v of input) peak = Math.max(peak, Math.abs(v));
      options.onLevel?.(Math.min(100, Math.round(peak * 200)));

      const resampled = downsample(input, captureCtx.sampleRate, INPUT_RATE);
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: floatsToPcm16Base64(resampled), mimeType: `audio/pcm;rate=${INPUT_RATE}` },
          },
        }),
      );
    };
  }

  return {
    close: cleanup,
    sendText(text: string) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
        }),
      );
    },
  };
}

// Le micro tourne à la fréquence de la carte son (48 kHz en général) alors
// que l'API attend 16 kHz. Moyenne sur la fenêtre plutôt que simple
// décimation : jeter des échantillons crée du repliement audible.
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function floatsToPcm16Base64(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
