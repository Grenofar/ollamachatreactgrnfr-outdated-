import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import MessageBubble from "../MessageBubble";
import SendButton from "../SendButton";
import {
  cancelControlMe,
  listSkills,
  onControlMeCancelled,
  onControlMeDone,
  onControlMeError,
  onControlMeLimit,
  onControlMeMessage,
  onControlMeStep,
  runControlMe,
  saveNewSkill,
} from "../../api";
import { BUILTIN_SKILLS } from "../../builtinSkills";
import type { Settings, SkillMeta } from "../../types";

// Espace dédié au jeu, distinct de Control Me : le parcours n'est pas le
// même. Ici on choisit d'abord un jeu, puis on lance, puis on parle à l'IA
// pendant qu'elle joue — alors que Control Me part d'une instruction écrite.
//
// Un jeu n'expose rien à l'accessibilité Windows : il dessine ses propres
// pixels. Cet espace force donc la perception par capture d'écran, quel que
// soit le réglage global — le mode « Windows UI », qui fait toute la vitesse
// de Control Me ailleurs, est littéralement aveugle devant un jeu.

interface GameDef {
  id: string;
  name: string;
  platform: string;
  /** Nom du skill intégré qui porte les réflexes de ce jeu. */
  skillName: string;
  summary: string;
}

const GAMES: GameDef[] = [
  {
    id: "kayak-and-surf",
    name: "Kayak and Surf",
    platform: "Roblox",
    skillName: "Roblox Kayak and Surf",
    summary:
      "Grimper les sommets à la rame, redescendre en kayak, ramasser des pièces et améliorer son équipement.",
  },
];

/** Skill de base chargé pour tous les jeux, y compris quand on en ignore la liste. */
const GENERIC_SKILL = "Farm de jeu";

type Entry = { role: "user" | "assistant" | "system"; content: string };

export default function GameView({ settings }: { settings: Settings }) {
  const [chosen, setChosen] = useState<GameDef | null>(null);
  const [ignored, setIgnored] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Ce que l'utilisateur tape pendant que l'IA agit : la boucle ne peut pas
  // recevoir un message en cours de route, donc on l'accumule et on le lui
  // donne au tour suivant plutôt que de le perdre ou de lancer une seconde
  // boucle en parallèle.
  const queuedRef = useRef<string[]>([]);
  const skillIdsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = settings.gemini_api_key?.trim() ?? "";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  useEffect(() => {
    const unlistens = [
      onControlMeStep((step) => {
        const intent = step.thought ? `${step.thought} — ` : "";
        setEntries((prev) => [...prev, { role: "system", content: `${intent}${step.args.label ?? step.action}` }]);
      }),
      onControlMeMessage((text) => setEntries((prev) => [...prev, { role: "assistant", content: text }])),
      onControlMeDone((summary) => {
        setEntries((prev) => [...prev, { role: "assistant", content: summary }]);
        setRunning(false);
      }),
      onControlMeError((message) => {
        setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${message}` }]);
        setRunning(false);
      }),
      onControlMeCancelled(() => {
        setEntries((prev) => [...prev, { role: "system", content: "Arrêté." }]);
        setRunning(false);
      }),
      onControlMeLimit(() => {
        setEntries((prev) => [
          ...prev,
          { role: "system", content: "Limite d'actions atteinte — relance pour continuer la session." },
        ]);
        setRunning(false);
      }),
    ];
    return () => {
      unlistens.forEach((p) => p.then((f) => f()));
    };
  }, []);

  // Dès qu'un tour se termine, on repart avec ce qui a été dit pendant —
  // sinon un renseignement donné en pleine action ne serait jamais lu.
  useEffect(() => {
    if (running || !playing) return;
    const pending = queuedRef.current;
    if (pending.length === 0) return;
    queuedRef.current = [];
    void launch(pending.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, playing]);

  /** Installe les skills manquants et renvoie les ids à fournir au modèle. */
  async function ensureSkills(game: GameDef | null): Promise<string[]> {
    const wanted = [GENERIC_SKILL, ...(game ? [game.skillName] : [])];
    let installed: SkillMeta[] = await listSkills().catch(() => []);
    for (const name of wanted) {
      if (installed.some((s) => s.name === name)) continue;
      const builtin = BUILTIN_SKILLS.find((b) => b.name === name);
      if (!builtin) continue;
      await saveNewSkill(builtin.name, builtin.description, builtin.content).catch(() => {});
      installed = await listSkills().catch(() => installed);
    }
    return installed.filter((s) => wanted.includes(s.name)).map((s) => s.id);
  }

  async function handleStart() {
    if (!apiKey) {
      setError("Ajoute ta clé API Gemini dans Réglages pour jouer.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      skillIdsRef.current = await ensureSkills(chosen);
      setPlaying(true);
      setEntries([
        {
          role: "system",
          content: chosen
            ? `Partie lancée sur ${chosen.name}. L'IA a ses réflexes pour ce jeu.`
            : "Partie lancée sans jeu reconnu. L'IA n'a que les actions génériques, pas de réflexe propre au jeu.",
        },
      ]);
      await launch(openingInstruction(chosen));
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }

  async function launch(instruction: string) {
    setRunning(true);
    try {
      await runControlMe(apiKey, settings.gemini_model, instruction, skillIdsRef.current, null, false);
    } catch (e) {
      setEntries((prev) => [...prev, { role: "system", content: `Erreur : ${e}` }]);
      setRunning(false);
    }
  }

  function handleSendNote() {
    const text = note.trim();
    if (!text) return;
    setNote("");
    setEntries((prev) => [...prev, { role: "user", content: text }]);
    if (running) {
      // Accumulé : repart tout seul dès que le tour en cours se termine.
      queuedRef.current.push(text);
      return;
    }
    void launch(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendNote();
    }
  }

  function handleStop() {
    queuedRef.current = [];
    cancelControlMe().catch(() => {});
  }

  function handleQuit() {
    handleStop();
    setPlaying(false);
    setEntries([]);
  }

  if (!playing) {
    return (
      <div className="gameview">
        <div className="gameview-header">
          <span className="gameview-title">Jeu</span>
        </div>

        <div className="gameview-pick">
          <p className="modal-hint">
            Choisis le jeu auquel l&apos;IA va jouer. Un jeu de la liste lui donne ses réflexes : le but, la
            progression, les touches qui comptent.
          </p>

          <div className="game-list">
            {GAMES.map((g) => (
              <button
                key={g.id}
                className={`game-card ${chosen?.id === g.id && !ignored ? "game-card-active" : ""}`}
                onClick={() => {
                  setChosen(g);
                  setIgnored(false);
                }}
              >
                <span className="game-card-name">{g.name}</span>
                <span className="game-card-platform">{g.platform}</span>
                <span className="modal-hint">{g.summary}</span>
              </button>
            ))}
          </div>

          <button
            className={`game-ignore ${ignored ? "game-card-active" : ""}`}
            onClick={() => {
              setIgnored(true);
              setChosen(null);
            }}
          >
            Ignorer — jouer à un autre jeu
          </button>
          {ignored && (
            <div className="modal-hint">
              L&apos;IA jouera quand même, mais sans aucun réflexe propre à ton jeu : elle ne connaîtra ni le but,
              ni la progression, ni les touches. Elle devra tout déduire de l&apos;écran, et tu devras beaucoup la
              guider.
            </div>
          )}

          <div className="modal-hint gameview-warning">
            L&apos;automatisation est interdite par les conditions d&apos;utilisation de nombreux jeux en ligne, et
            certains la détectent — ton compte peut être sanctionné. À toi de décider en connaissance de cause.
          </div>

          <button
            className="primary-btn gameview-start"
            onClick={() => void handleStart()}
            disabled={(!chosen && !ignored) || starting}
          >
            {starting ? "Préparation…" : "Commencer à jouer"}
          </button>
          {error && <div className="banner banner-error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="gameview">
      <div className="gameview-header">
        <span className="gameview-title">{chosen ? chosen.name : "Jeu non reconnu"}</span>
        <div className="controlme-header-spacer" />
        {running && <span className="modal-hint">L&apos;IA joue…</span>}
        <button onClick={handleStop} disabled={!running}>
          Arrêter
        </button>
        <button onClick={handleQuit}>Quitter la partie</button>
      </div>

      <div className="controlme-scroll" ref={scrollRef}>
        {entries.map((e, i) => (
          <MessageBubble key={i} role={e.role} content={e.content} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>

      <div className="input-pill">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            running
              ? "Dis-lui quelque chose — elle le lira dès la fin de son action en cours"
              : "Donne-lui un renseignement ou une consigne"
          }
          rows={1}
        />
        <SendButton busy={running} onSend={handleSendNote} onStop={handleStop} disabled={!note.trim() && !running} />
      </div>
    </div>
  );
}

function openingInstruction(game: GameDef | null): string {
  const common =
    "Tu joues à un jeu vidéo sur cet ordinateur. Regarde l'écran avant d'agir. " +
    "Les actions qui durent (maintenir une touche, maintenir un clic, déplacer la souris sur une durée) " +
    "sont celles qui fonctionnent dans un jeu — un appui instantané ne fait souvent rien. " +
    "Fais un cycle complet, regarde le résultat, et seulement ensuite recommence. " +
    "Si l'écran ne change plus entre deux cycles, arrête-toi et dis-le.";
  if (!game) {
    return `${common}\n\nTu ne connais pas ce jeu. Commence par décrire ce que tu vois et demande ce qu'il faut faire, plutôt que d'agir au hasard.`;
  }
  return `${common}\n\nLe jeu est ${game.name} sur ${game.platform}. Tes compétences pour ce jeu te sont fournies avec cette instruction : lis-les et applique-les. Commence par regarder l'écran et dire où en est la partie, puis lance la boucle décrite dans ta compétence.`;
}
