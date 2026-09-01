import { useEffect, useState } from "react";
import {
  deleteSkill,
  downloadSkill,
  extractSkillFromTranscript,
  listControlMeSessions,
  listPublicSkills,
  listSkills,
  loadControlMeSession,
  loadSkill,
  openSkillsFolder,
  publishSkill,
  saveNewSkill,
  unpublishSkill,
  updateSkill,
} from "../api";
import type { ControlMeSessionMeta, PublicSkillMeta, Settings, Skill, SkillMeta } from "../types";

// Dedicated space for extensions, next to Codex/Control Me/Paramètres in
// the Sidebar — the functional interface for each extension lives here;
// Réglages > Extensions only ever shows the name/description of what's
// installed plus a settings shortcut, never the interactive parts (this
// file). "Tout mettre à jour" also lives in Réglages > Extensions, not
// here — see SettingsView.tsx.
//
// Codex and Control Me are listed as cards here too, alongside their own
// dedicated Sidebar entries (both paths stay available, on request) — for
// these two, "désinstaller" only ever means hiding the Sidebar entry
// (disabled_extensions in Settings), never actually removing code: every
// feature ships compiled into the same single binary, there is no real
// per-feature module system. Skills are different: they're real local
// files the app itself created, so "Désinstaller" on a skill genuinely
// deletes it.
const NEW_SKILL = "__new__";

function transcriptFromEntries(entries: { role: string; content: string }[]): string {
  return entries.map((e) => `${e.role}: ${e.content}`).join("\n");
}

export default function ExtensionsView({
  settings,
  onOpenCodex,
  onOpenControlMe,
  onToggleExtension,
}: {
  settings: Settings;
  onOpenCodex: () => void;
  onOpenControlMe: () => void;
  onToggleExtension: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [sessions, setSessions] = useState<ControlMeSessionMeta[] | null>(null);
  const [extractSessionId, setExtractSessionId] = useState("");
  const [extracting, setExtracting] = useState(false);

  const [showPublicBrowse, setShowPublicBrowse] = useState(false);
  const [publicSkills, setPublicSkills] = useState<PublicSkillMeta[] | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);

  function refreshSkills() {
    listSkills()
      .then(setSkills)
      .catch((e) => setSkillsError(String(e)));
  }

  useEffect(() => {
    refreshSkills();
    listControlMeSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  function openNewSkillForm() {
    setEditingId(NEW_SKILL);
    setEditName("");
    setEditDescription("");
    setEditContent("");
    setExtractSessionId("");
  }

  function openEditForm(skill: Skill | SkillMeta, content = "") {
    setEditingId(skill.id);
    setEditName(skill.name);
    setEditDescription(skill.description);
    setEditContent(content);
    setExtractSessionId("");
  }

  async function handleSelectSkill(meta: SkillMeta) {
    // list_skills only returns metadata (no content, kept light) — load the
    // full record once the user actually opens it for editing.
    try {
      const full = await loadSkill(meta.id);
      openEditForm(full, full.content);
    } catch (e) {
      setSkillsError(String(e));
    }
  }

  function closeEditor() {
    setEditingId(null);
  }

  async function handleSaveSkill() {
    setSaving(true);
    setSkillsError(null);
    try {
      if (editingId === NEW_SKILL) {
        await saveNewSkill(editName.trim(), editDescription.trim(), editContent);
      } else if (editingId) {
        await updateSkill({
          id: editingId,
          name: editName.trim(),
          description: editDescription.trim(),
          content: editContent,
          is_public: skills?.find((s) => s.id === editingId)?.is_public ?? false,
          share_code: skills?.find((s) => s.id === editingId)?.share_code ?? null,
          created_at: skills?.find((s) => s.id === editingId)?.created_at ?? Date.now() / 1000,
        });
      }
      closeEditor();
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSkill(id: string) {
    if (!window.confirm("Désinstaller ce skill ? Le fichier local sera supprimé définitivement.")) return;
    try {
      await deleteSkill(id);
      if (editingId === id) closeEditor();
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    }
  }

  async function handlePublishSkill(id: string) {
    if (
      !window.confirm(
        "Ce skill sera visible publiquement par n'importe qui, sans limite de durée, et ne peut pas être retiré depuis cette version de l'app — ne publie rien de sensible. Continuer ?",
      )
    ) {
      return;
    }
    setPublishing(true);
    setSkillsError(null);
    try {
      await publishSkill(id);
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublishSkill(id: string) {
    setPublishing(true);
    try {
      await unpublishSkill(id);
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    } finally {
      setPublishing(false);
    }
  }

  // "quand ya qu'un seul fichier choisi" is satisfied by construction here:
  // the editor only ever has exactly one skill open at a time, so there's
  // no state where "several are selected" could even happen — no separate
  // warning message needed for that case.
  async function handleExtract() {
    if (!editingId || editingId === NEW_SKILL || !extractSessionId) return;
    const apiKey = settings.gemini_api_key?.trim() ?? "";
    if (!apiKey) {
      setSkillsError("Configure ta clé API Gemini dans Réglages avant d'extraire des informations.");
      return;
    }
    setExtracting(true);
    setSkillsError(null);
    try {
      const session = await loadControlMeSession(extractSessionId);
      const transcript = transcriptFromEntries(session.entries);
      const proposed = await extractSkillFromTranscript(apiKey, settings.gemini_model, editContent, transcript);
      setEditContent(proposed);
    } catch (e) {
      setSkillsError(String(e));
    } finally {
      setExtracting(false);
    }
  }

  function toggleBrowsePublic() {
    if (showPublicBrowse) {
      setShowPublicBrowse(false);
      return;
    }
    setShowPublicBrowse(true);
    if (publicSkills === null) {
      listPublicSkills()
        .then(setPublicSkills)
        .catch(() => setPublicSkills([]));
    }
  }

  async function handleDownloadPublic(code: string) {
    try {
      await downloadSkill(code);
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    }
  }

  async function handleImportByCode() {
    const code = importCode.trim();
    if (!code) return;
    setImporting(true);
    setSkillsError(null);
    try {
      await downloadSkill(code);
      setImportCode("");
      refreshSkills();
    } catch (e) {
      setSkillsError(String(e));
    } finally {
      setImporting(false);
    }
  }

  const query = search.trim().toLowerCase();
  const matches = (name: string, description: string) =>
    !query || name.toLowerCase().includes(query) || description.toLowerCase().includes(query);

  const codexEnabled = !settings.disabled_extensions.includes("codex");
  const controlMeEnabled = !settings.disabled_extensions.includes("controlme");
  const filteredSkills = (skills ?? []).filter((s) => matches(s.name, s.description));
  const showCodexCard = matches(
    "Codex",
    "Éditeur de code façon VS Code où un modèle Ollama agit en agent sur ton PC",
  );
  const showControlMeCard = matches(
    "Control Me",
    "Une IA contrôle ta souris et ton clavier à partir de captures d'écran ou de l'accessibilité Windows",
  );

  return (
    <div className="extensions-view">
      <div className="extensions-header">
        <span className="extensions-header-title">Extensions</span>
        <div className="extensions-header-spacer" />
        <input
          className="extensions-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une extension ou un skill…"
        />
      </div>

      <div className="extensions-content">
        {showCodexCard && (
          <div className="extension-card">
            <div className="extension-card-header">
              <strong>Codex</strong>
              <span className="modal-hint">
                Éditeur de code façon VS Code où un modèle Ollama agit en agent sur ton PC (lecture/
                écriture de fichiers, commandes PowerShell).
              </span>
            </div>
            <div className="extension-card-actions">
              <button className="primary-btn" onClick={onOpenCodex} disabled={!codexEnabled}>
                Ouvrir
              </button>
              <button onClick={() => onToggleExtension("codex")}>{codexEnabled ? "Désactiver" : "Réactiver"}</button>
            </div>
            {!codexEnabled && (
              <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
            )}
          </div>
        )}

        {showControlMeCard && (
          <div className="extension-card">
            <div className="extension-card-header">
              <strong>Control Me</strong>
              <span className="modal-hint">
                Une IA (Gemini) contrôle ta souris et ton clavier à partir de captures d'écran ou de
                l'accessibilité Windows — en local ou à distance depuis le site.
              </span>
            </div>
            <div className="extension-card-actions">
              <button className="primary-btn" onClick={onOpenControlMe} disabled={!controlMeEnabled}>
                Ouvrir
              </button>
              <button onClick={() => onToggleExtension("controlme")}>
                {controlMeEnabled ? "Désactiver" : "Réactiver"}
              </button>
            </div>
            {!controlMeEnabled && (
              <div className="modal-hint">Masqué de la Sidebar. Rien n'est supprimé, réactivable à tout moment.</div>
            )}
          </div>
        )}

        <div className="extension-card">
          <div className="extension-card-header">
            <strong>DB skill for Control Me</strong>
            <span className="modal-hint">
              Des skills nommés et décrits que tu crées toi-même (ou qu'une session Control Me extrait pour
              toi) — choisis lesquels fournir à l'IA avant une discussion. Différent de la mémoire
              auto-apprise : ici, c'est toi qui décides quoi garder.
            </span>
          </div>

          {skillsError && <div className="install-error">{skillsError}</div>}

          <div className="extension-card-actions">
            <button className="primary-btn" onClick={openNewSkillForm}>
              Nouveau skill
            </button>
            <button onClick={() => openSkillsFolder().catch((e) => setSkillsError(String(e)))}>
              Ouvrir le dossier
            </button>
            <button onClick={toggleBrowsePublic}>{showPublicBrowse ? "Fermer" : "Parcourir les skills publics"}</button>
          </div>

          {skills === null ? (
            <div className="modal-hint">Chargement…</div>
          ) : filteredSkills.length === 0 ? (
            <div className="modal-hint">
              {skills.length === 0 ? "Aucun skill créé pour l'instant." : "Aucun skill ne correspond à la recherche."}
            </div>
          ) : (
            <div className="skill-list">
              {filteredSkills.map((s) => (
                <div key={s.id} className="skill-row">
                  <button className="skill-row-main" onClick={() => handleSelectSkill(s)}>
                    <strong>{s.name}</strong>
                    <span className="modal-hint">{s.description}</span>
                  </button>
                  {s.is_public && <span className="hf-fit-badge hf-fit-ok">Public</span>}
                  <button className="skill-row-delete" onClick={() => handleDeleteSkill(s.id)} title="Désinstaller">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {showPublicBrowse && (
            <div className="skill-public-browse">
              {publicSkills === null ? (
                <div className="modal-hint">Chargement…</div>
              ) : publicSkills.length === 0 ? (
                <div className="modal-hint">Aucun skill public pour l'instant.</div>
              ) : (
                <div className="skill-list">
                  {publicSkills.map((s) => (
                    <div key={s.share_code} className="skill-row">
                      <div className="skill-row-main">
                        <strong>{s.name}</strong>
                        <span className="modal-hint">{s.description}</span>
                      </div>
                      <button onClick={() => handleDownloadPublic(s.share_code)}>Importer</button>
                    </div>
                  ))}
                </div>
              )}

              <label>Importer via un code</label>
              <div className="modal-actions">
                <input value={importCode} onChange={(e) => setImportCode(e.target.value)} placeholder="Code partagé" />
                <button onClick={handleImportByCode} disabled={importing || !importCode.trim()}>
                  {importing ? "Import…" : "Importer"}
                </button>
              </div>
            </div>
          )}

          {editingId && (
            <div className="skill-editor">
              <label>Nom</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nom du skill (obligatoire)" />
              <label>Description</label>
              <input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (obligatoire)"
              />
              <label>Contenu</label>
              <textarea
                rows={8}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Ce que l'IA doit savoir pour ce skill…"
              />

              {editingId !== NEW_SKILL && sessions !== null && sessions.length > 0 && (
                <>
                  <label>Extraire les informations depuis une session</label>
                  <div className="modal-actions">
                    <select value={extractSessionId} onChange={(e) => setExtractSessionId(e.target.value)}>
                      <option value="">Choisir une session…</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                    <button onClick={handleExtract} disabled={!extractSessionId || extracting}>
                      {extracting ? "Extraction…" : "Extraire les informations"}
                    </button>
                  </div>
                </>
              )}

              <div className="modal-actions">
                {editingId !== NEW_SKILL && (
                  <>
                    {skills?.find((s) => s.id === editingId)?.is_public ? (
                      <button onClick={() => handleUnpublishSkill(editingId)} disabled={publishing}>
                        Rendre privé
                      </button>
                    ) : (
                      <button onClick={() => handlePublishSkill(editingId)} disabled={publishing}>
                        {publishing ? "Publication…" : "Publier en public"}
                      </button>
                    )}
                    <button onClick={() => handleDeleteSkill(editingId)}>Désinstaller</button>
                  </>
                )}
                <button onClick={closeEditor}>Annuler</button>
                <button className="primary-btn" onClick={handleSaveSkill} disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
              {skills?.find((s) => s.id === editingId)?.share_code && (
                <div className="modal-hint">
                  Code partagé : <strong>{skills.find((s) => s.id === editingId)?.share_code}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
