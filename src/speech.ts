// Sortie vocale par Gemini, en alternative aux voix SAPI de Windows.
// Celles-ci sonnent robotiques, ce qui suffit à faire passer une
// conversation vocale pour un lecteur d'écran plutôt que pour quelqu'un
// qui parle.
//
// Point vérifié dans la documentation, pas supposé : l'API renvoie du
// **PCM brut** (mono, 24 kHz, 16 bits) même quand elle annonce
// "audio/wav". Le donner tel quel à un <audio> ne produit rien — il faut
// lui écrire un en-tête WAV devant. Le contrôle RIFF ci-dessous fait que le
// code marche dans les deux cas, si l'API venait à renvoyer un vrai
// fichier.

import { synthesizeSpeech } from "./api";

const SAMPLE_RATE = 24000;

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function isGeminiVoiceAvailable(apiKey: string | undefined | null): boolean {
  return !!apiKey?.trim();
}

export function stopGeminiSpeech(): void {
  if (current) {
    current.pause();
    current.src = "";
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Parle avec une voix Gemini. Rejette si l'API échoue, pour que l'appelant
 * puisse retomber sur la voix du système plutôt que rester muet. */
export async function speakWithGemini(
  text: string,
  apiKey: string,
  voice: string,
  onDone?: () => void,
): Promise<void> {
  const base64 = await synthesizeSpeech(apiKey, "", text, voice);
  const bytes = base64ToBytes(base64);
  const wav = looksLikeWav(bytes) ? bytes : wrapPcmInWav(bytes, SAMPLE_RATE);

  stopGeminiSpeech();
  const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
  currentUrl = URL.createObjectURL(blob);
  const audio = new Audio(currentUrl);
  current = audio;
  // onDone est appelé aussi en cas d'erreur de lecture : dans une
  // conversation, ne jamais rendre la parole serait pire que la rendre trop
  // tôt — l'échange s'arrêterait net.
  audio.onended = () => {
    stopGeminiSpeech();
    onDone?.();
  };
  audio.onerror = () => {
    stopGeminiSpeech();
    onDone?.();
  };
  await audio.play();
}

function looksLikeWav(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// En-tête WAV 16 bits mono minimal, écrit à la main : aucune dépendance à
// ajouter pour 44 octets.
function wrapPcmInWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM non compressé
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits par échantillon
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);

  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

// Voix Gemini, avec le caractère annoncé par Google pour chacune — c'est ce
// qui permet de choisir autrement qu'au hasard.
export const GEMINI_VOICES = [
  { id: "Kore", label: "Kore — ferme, posée" },
  { id: "Puck", label: "Puck — enjouée" },
  { id: "Charon", label: "Charon — grave, informative" },
  { id: "Aoede", label: "Aoede — légère" },
  { id: "Fenrir", label: "Fenrir — énergique" },
  { id: "Leda", label: "Leda — jeune, claire" },
  { id: "Orus", label: "Orus — assurée" },
  { id: "Zephyr", label: "Zephyr — lumineuse" },
];
