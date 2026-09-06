import { useEffect, useState } from "react";
import { extractSkillFromTranscript, listControlMeSessions, listSkills, loadControlMeSession, loadSkill, updateSkill } from "../api";
import type { ControlMeSessionMeta, SkillMeta } from "../types";

// Which skills each past Control Me conversation used, and a way to improve
// them from there. The point is that a skill gets better from the sessions
// that actually exercised it: this panel is where you see "that session used
// this skill" and can fold what happened in it back into the skill, instead
// of having to remember which conversation taught what.
export default function SessionSkills({
  geminiApiKey,
  geminiModel,
}: {
  geminiApiKey: string;
  geminiModel: string;
}) {
  const [sessions, setSessions] = useState<ControlMeSessionMeta[] | null>(null);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    listControlMeSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  function skillName(id: string): string {
    return skills.find((s) => s.id === id)?.name ?? "(skill supprimé)";
  }

  async function improve(sessionId: string, skillId: string) {
    if (!geminiApiKey.trim()) {
      setStatus("Ajoute ta clé API Gemini plus haut pour pouvoir améliorer un skill.");
      return;
    }
    setBusy(sessionId + skillId);
    setStatus(null);
    try {
      const session = await loadControlMeSession(sessionId);
      const skill = await loadSkill(skillId);
      const transcript = session.entries.map((e) => `${e.role}: ${e.content}`).join("\n");
      // existingContent is what makes this an update rather than a rewrite
      // from scratch — the skill keeps what still holds and gains what this
      // conversation showed.
      const content = await extractSkillFromTranscript(geminiApiKey, geminiModel, skill.content, transcript);
      await updateSkill({ ...skill, content });
      setStatus(`« ${skill.name} » a été enrichi avec cette conversation.`);
    } catch (e) {
      setStatus(`Échec : ${e}`);
    } finally {
      setBusy(null);
    }
  }

  const used = (sessions ?? []).filter((s) => (s.skill_ids?.length ?? 0) > 0);

  return (
    <>
      <label>Skills utilisés par conversation</label>
      {sessions === null ? (
        <div className="audio-status">Chargement…</div>
      ) : used.length === 0 ? (
        <div className="audio-status">
          Aucune conversation n&apos;a encore utilisé de skill. Coche des skills dans Control Me, ou lance un
          apprentissage — ils apparaîtront ici.
        </div>
      ) : (
        <div className="session-skill-list">
          {used.map((s) => (
            <div key={s.id} className="session-skill-row">
              <div className="session-skill-title">{s.title}</div>
              <div className="session-skill-tags">
                {(s.skill_ids ?? []).map((id) => (
                  <span key={id} className="session-skill-tag">
                    {skillName(id)}
                    <button
                      className="session-skill-improve"
                      disabled={busy !== null}
                      onClick={() => void improve(s.id, id)}
                      title="Relire cette conversation et enrichir ce skill avec ce qu'elle contient"
                    >
                      {busy === s.id + id ? "…" : "Améliorer"}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {status && <div className="audio-status">{status}</div>}
    </>
  );
}
