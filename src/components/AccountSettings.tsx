import { useEffect, useState } from "react";
import { beginSignIn, fetchProfile, isExpired, loadSession, onSessionChange, saveProfile, signOut, type Profile, type Session } from "../account";

// Account panel. Signing in exists for one concrete reason: publishing a
// skill and leaving a review both need an author. Everything else in this
// app works without an account and stays that way.
export default function AccountSettings() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSessionChange(setSession), []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    fetchProfile(session)
      .then((p) => {
        setProfile(p);
        setUsername(p?.username ?? "");
      })
      .catch((e) => setStatus(String(e)));
  }, [session]);

  const expired = isExpired(session);

  async function handleSaveProfile() {
    if (!session) return;
    setBusy(true);
    setStatus(null);
    try {
      await saveProfile(session, { username: username.trim() });
      const p = await fetchProfile(session);
      setProfile(p);
      setStatus("Profil enregistré.");
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeveloper() {
    if (!session || !profile) return;
    setBusy(true);
    try {
      await saveProfile(session, { is_developer: !profile.is_developer });
      setProfile({ ...profile, is_developer: !profile.is_developer });
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <h2>Compte</h2>
      <p className="modal-hint">
        Un compte sert uniquement à publier des skills et à laisser des avis : sans lui, tout le reste de
        l&apos;application fonctionne normalement. Publier sans compte n&apos;est pas possible — un skill sans auteur
        est un skill dont personne ne répond.
      </p>

      {!session || expired ? (
        <>
          {expired && session && (
            <div className="audio-status">Ta session a expiré. Reconnecte-toi pour publier ou noter.</div>
          )}
          <button className="primary-btn" onClick={() => void beginSignIn()}>
            Se connecter avec Google
          </button>
          <p className="modal-hint">
            La connexion s&apos;ouvre dans ton navigateur, puis revient dans l&apos;application toute seule.
          </p>
        </>
      ) : (
        <>
          <div className="account-row">
            {session.picture && <img className="account-avatar" src={session.picture} alt="" />}
            <div>
              <div className="account-name">{profile?.username || session.email || "Compte connecté"}</div>
              <div className="modal-hint">{session.email}</div>
            </div>
            <div className="settings-nav-spacer" />
            <button className="account-signout" onClick={signOut}>
              Se déconnecter
            </button>
          </div>

          <label>Pseudo public</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3 à 24 caractères, minuscules, chiffres ou _"
          />
          <div className="audio-row">
            <button onClick={() => void handleSaveProfile()} disabled={busy || !username.trim()}>
              {busy ? "…" : profile?.username ? "Changer le pseudo" : "Choisir ce pseudo"}
            </button>
            <span className="modal-hint">C&apos;est le nom affiché comme auteur de tes skills publiés.</span>
          </div>

          {profile && (
            <div className="audio-row">
              <button onClick={() => void toggleDeveloper()} disabled={busy}>
                {profile.is_developer ? "Désactiver le mode développeur" : "Activer le mode développeur"}
              </button>
              <span className="modal-hint">
                {profile.is_developer
                  ? "Tu peux publier des extensions depuis le site."
                  : "Nécessaire pour publier une extension sur la marketplace du site."}
              </span>
            </div>
          )}
        </>
      )}

      {status && <div className="audio-status">{status}</div>}
    </div>
  );
}
