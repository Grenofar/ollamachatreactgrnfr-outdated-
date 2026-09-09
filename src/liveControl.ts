// Control Me piloté par une session Live : au lieu d'un aller-retour REST
// complet par action (capture → requête → réponse → action → attente), une
// seule connexion reste ouverte, reçoit l'écran en continu et renvoie des
// appels d'outils au fil de l'eau. Le modèle peut enchaîner plusieurs
// actions par seconde sans repayer le coût d'établissement à chaque fois.
//
// Ce qui n'est PAS possible, et qu'il vaut mieux savoir avant d'espérer :
// analyser 300 images/seconde en 1 ms. L'aller-retour réseau seul coûte
// 20-100 ms, l'inférence plusieurs centaines, et à ce débit le plafond de
// jetons du modèle Live serait épuisé en quelques secondes — une image vaut
// plusieurs centaines de jetons. Le débit est donc réglable dans une plage
// réaliste, et le vrai gain vient du nombre d'actions par tour, pas du
// nombre d'images.

import { controlMeAct, controlMeReadUi, controlMeScreen, controlMeTools } from "./api";
import { LIVE_MODEL } from "./liveVoice";

const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Bornes assumées : en dessous le modèle ne suit plus ce qui se passe, au
 * dessus on brûle le quota de jetons sans que le modèle ait le temps de
 * regarder les images. */
export const MIN_FPS = 0.2;
export const MAX_FPS = 5;

export interface LiveControlOptions {
  apiKey: string;
  model?: string;
  instruction: string;
  /** "windows_ui" n'envoie aucune image : uniquement le texte de
   * l'accessibilité. Nettement plus rapide et sans coût d'image. */
  perception: "capture" | "windows_ui";
  /** Images (ou lectures d'interface) par seconde. */
  fps: number;
  recordingSkillId?: string | null;
  onStep: (label: string) => void;
  onMessage: (text: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface LiveControlSession {
  stop(): void;
  say(text: string): void;
}

export async function startLiveControl(options: LiveControlOptions): Promise<LiveControlSession> {
  const tools = toLiveTools(await controlMeTools());
  const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(options.apiKey)}`);

  let closed = false;
  let ready = false;
  let observing = false;
  let timer: number | null = null;
  const fps = Math.min(MAX_FPS, Math.max(MIN_FPS, options.fps));

  const stop = () => {
    if (closed) return;
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        setup: {
          model: `models/${options.model?.trim() || LIVE_MODEL}`,
          // TEXT et non AUDIO : ici le modèle agit, il n'a pas à parler.
          // Demander de l'audio doublerait le coût pour rien.
          generationConfig: { responseModalities: ["TEXT"] },
          systemInstruction: { parts: [{ text: buildBrief(options) }] },
          tools,
        },
      }),
    );
  };

  ws.onerror = () => options.onError("La connexion temps réel a échoué.");

  ws.onclose = (event) => {
    if (!closed && event.code !== 1000) {
      options.onError(
        event.reason?.trim()
          ? `Session temps réel fermée : ${event.reason}`
          : `Session temps réel fermée (code ${event.code}).`,
      );
    }
    stop();
    options.onClose();
  };

  ws.onmessage = async (event) => {
    const raw = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.setupComplete !== undefined && !ready) {
      ready = true;
      // La première observation part tout de suite : sans elle le modèle
      // n'a rien à regarder et attendrait le premier tick pour rien.
      void observeLoop();
      return;
    }

    const toolCall = msg.toolCall as { functionCalls?: { id?: string; name: string; args?: unknown }[] } | undefined;
    if (toolCall?.functionCalls?.length) {
      await runToolCalls(toolCall.functionCalls);
      return;
    }

    const server = msg.serverContent as
      | { modelTurn?: { parts?: { text?: string }[] } }
      | undefined;
    for (const part of server?.modelTurn?.parts ?? []) {
      if (part.text?.trim()) options.onMessage(part.text);
    }
  };

  async function runToolCalls(calls: { id?: string; name: string; args?: unknown }[]) {
    const responses: { id?: string; name: string; response: Record<string, unknown> }[] = [];
    for (const call of calls) {
      if (closed) return;
      try {
        const result = await controlMeAct(call.name, (call.args ?? {}) as Record<string, unknown>, options.recordingSkillId ?? null);
        options.onStep(`${call.name} — ${result}`);
        responses.push({ id: call.id, name: call.name, response: { output: result } });
      } catch (e) {
        // L'échec est renvoyé au modèle plutôt qu'avalé : il doit pouvoir
        // s'adapter, exactement comme dans la boucle REST.
        const message = String(e);
        options.onStep(`${call.name} — échec : ${message}`);
        responses.push({ id: call.id, name: call.name, response: { error: message } });
      }
    }
    if (closed || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    // Une observation fraîche juste après les actions : c'est ce qui permet
    // au modèle de voir le résultat de ce qu'il vient de faire.
    void observe();
  }

  async function observe() {
    if (closed || !ready || observing || ws.readyState !== WebSocket.OPEN) return;
    observing = true;
    try {
      if (options.perception === "windows_ui") {
        const text = await controlMeReadUi();
        ws.send(JSON.stringify({ realtimeInput: { text } }));
      } else {
        const shot = await controlMeScreen();
        ws.send(
          JSON.stringify({
            realtimeInput: { video: { data: shot.image_base64, mimeType: "image/jpeg" } },
          }),
        );
      }
    } catch (e) {
      options.onError(String(e));
    } finally {
      observing = false;
    }
  }

  async function observeLoop() {
    if (closed) return;
    await observe();
    if (closed) return;
    // setTimeout enchaîné plutôt que setInterval : si une capture prend plus
    // longtemps que l'intervalle, les appels s'empileraient et sature­raient
    // la connexion au lieu de ralentir.
    timer = window.setTimeout(() => void observeLoop(), Math.round(1000 / fps));
  }

  return {
    stop,
    say(text: string) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
        }),
      );
    },
  };
}

// Les déclarations côté Rust sont au format de l'API REST
// ({type, name, description, parameters}, une entrée par outil). Le Live
// attend la forme classique de Gemini : un seul objet Tool contenant un
// tableau functionDeclarations, et **sans** le champ `type` — c'est lui qui
// faisait rejeter tout le setup avec
// « Unknown name "description" at 'setup.tools' ».
// La conversion est faite ici plutôt que d'ajouter un second jeu de
// déclarations côté Rust : une seule source de vérité, deux formats de
// sortie.
function toLiveTools(raw: unknown): unknown[] {
  const list = Array.isArray(raw) ? raw : [];
  const declarations = list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      name: t.name,
      description: t.description,
      // Un outil sans paramètre doit quand même annoncer un objet vide,
      // sinon la déclaration est refusée.
      parameters: t.parameters ?? { type: "object", properties: {} },
    }))
    .filter((t) => typeof t.name === "string" && t.name.length > 0);
  return declarations.length ? [{ functionDeclarations: declarations }] : [];
}

function buildBrief(options: LiveControlOptions): string {
  const perception =
    options.perception === "windows_ui"
      ? "Tu reçois en continu le texte de l'interface de la fenêtre au premier plan (type, libellé et position 0-999 de chaque contrôle)."
      : "Tu reçois en continu des captures de l'écran. Les positions que tu donnes sont normalisées de 0 à 999.";
  return `${options.instruction}

${perception}
Tu contrôles réellement cet ordinateur : quand tu appelles un outil, l'action s'exécute vraiment.
Tu peux enchaîner plusieurs actions d'affilée sans attendre, tant que tu es sûr de la suite. Si tu as un doute sur le résultat d'une action, fais-en une seule et regarde ce qui a changé.
N'annonce pas ce que tu vas faire : fais-le. Écris seulement pour poser une question ou pour signaler que c'est terminé.`;
}
