// Account for the desktop app: Google sign-in through Supabase, so that
// publishing a skill and leaving a review can be attributed to someone.
// Publishing anonymously is exactly what the site's marketplace could not
// allow either — a skill with no author is a skill nobody can be
// accountable for.
//
// No @supabase/supabase-js here: this project deliberately talks to
// Supabase over plain REST (see CLAUDE.md > Décisions techniques), and
// adding the JS client would need an npm install, which is off the table.
// The OAuth flow is therefore done by hand:
//   1. open the system browser at Supabase's authorize URL, asking it to
//      come back to ollamachat://auth
//   2. Supabase redirects there with the tokens in the URL fragment
//   3. the deep-link handler in App.tsx feeds that URL to completeSignIn
// The redirect URL must be allow-listed in the Supabase dashboard
// (Authentication > URL Configuration > Redirect URLs) or step 2 is
// refused — a one-off manual step, like every SQL migration in this repo.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig";

const STORAGE_KEY = "ollamachat_session";

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  user_id: string;
  email?: string;
  /** Google's picture, used until a profile avatar is uploaded. */
  picture?: string;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_developer: boolean;
}

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(session: Session | null) {
  listeners.forEach((fn) => fn(session));
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the session simply won't survive a
    // restart, which is better than failing the sign-in outright.
  }
  emit(session);
}

export function signOut() {
  storeSession(null);
}

/** Opens the system browser at Google sign-in. Returns once the browser is
 * launched — the result comes back later through the deep link. */
export async function beginSignIn(): Promise<void> {
  const redirect = encodeURIComponent("ollamachat://auth");
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Parses the ollamachat://auth callback. Supabase puts the tokens in the
 * fragment, which `new URL()` exposes as `hash`. */
export function completeSignIn(rawUrl: string): Session | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const params = new URLSearchParams(fragment || parsed.search.replace(/^\?/, ""));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token") ?? "";
  if (!access_token) return null;

  const claims = decodeJwt(access_token);
  const session: Session = {
    access_token,
    refresh_token,
    expires_at: Number(params.get("expires_at")) || claims?.exp || 0,
    user_id: claims?.sub ?? "",
    email: claims?.email,
    picture: claims?.user_metadata?.avatar_url ?? claims?.user_metadata?.picture,
  };
  if (!session.user_id) return null;
  storeSession(session);
  return session;
}

interface JwtClaims {
  sub?: string;
  exp?: number;
  email?: string;
  user_metadata?: { avatar_url?: string; picture?: string };
}

// The token is read only to know who is signed in and when it expires; it
// is never trusted for authorisation, which happens server-side under RLS.
function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json))) as JwtClaims;
  } catch {
    return null;
  }
}

export function isExpired(session: Session | null): boolean {
  if (!session) return true;
  if (!session.expires_at) return false;
  return session.expires_at * 1000 <= Date.now();
}

function authHeaders(session: Session): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchProfile(session: Session): Promise<Profile | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}&select=id,username,avatar_url,is_developer`,
    { headers: authHeaders(session) },
  );
  if (!res.ok) throw new Error(`Profil illisible (${res.status})`);
  const rows = (await res.json()) as Profile[];
  return rows[0] ?? null;
}

/** Creates the profile row on first sign-in, or updates the chosen fields. */
export async function saveProfile(
  session: Session,
  fields: { username?: string; avatar_url?: string | null; is_developer?: boolean },
): Promise<void> {
  const existing = await fetchProfile(session).catch(() => null);
  const body = { id: session.user_id, ...fields };
  const res = existing
    ? await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user_id)}`, {
        method: "PATCH",
        headers: { ...authHeaders(session), Prefer: "return=minimal" },
        body: JSON.stringify(fields),
      })
    : await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: { ...authHeaders(session), Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
  if (!res.ok) {
    const text = await res.text();
    // The username has a unique constraint and a strict format check, so
    // this is the common failure and deserves a readable message.
    if (text.includes("duplicate key")) throw new Error("Ce pseudo est déjà pris.");
    if (text.includes("profiles_username_check")) {
      throw new Error("Pseudo invalide : 3 à 24 caractères, en minuscules, chiffres ou _ uniquement.");
    }
    throw new Error(`Échec de l'enregistrement du profil (${res.status})`);
  }
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
