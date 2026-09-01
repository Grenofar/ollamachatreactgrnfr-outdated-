// Shared account bar (login/profile/devices/dev toggle) — loaded by both
// index.html and controlremote.html so the same "logged in as..." state
// and UI appears everywhere on the site, not just one page. Plain ESM,
// no bundler (same zero-build philosophy as the rest of site/).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://cihuwuiyziarnghethbi.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AVATAR_BUCKET = "avatars";
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

let currentProfile = null; // { id, username, avatar_url, is_developer } | null
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(currentProfile));
}

// Other scripts on the same page (controlremote.html's own pairing logic
// in particular, to attach a device to the logged-in account) subscribe
// here instead of re-implementing session tracking.
export function onProfileChange(fn) {
  listeners.add(fn);
  fn(currentProfile);
  return () => listeners.delete(fn);
}

export function getProfile() {
  return currentProfile;
}

async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    console.error("[account] profile load failed", error);
    return null;
  }
  return data;
}

async function refreshFromSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    currentProfile = null;
    notify();
    return;
  }
  currentProfile = await loadProfile(session.user.id);
  notify();
}

supabase.auth.onAuthStateChange(() => {
  refreshFromSession();
});

export async function signInWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}

// First profile creation after a fresh Google sign-in: no username chosen
// yet, so callers should treat `currentProfile === null` while
// `supabase.auth.getSession()` has a user as "needs onboarding", not
// "logged out" — renderAccountBar below handles that distinction.
export async function claimUsername(username) {
  const trimmed = username.trim().toLowerCase();
  if (!USERNAME_RE.test(trimmed)) {
    throw new Error("Le pseudo doit faire 3 à 24 caractères : lettres minuscules, chiffres, underscore.");
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Pas connecté.");
  const { error } = await supabase
    .from("profiles")
    .insert({ id: session.user.id, username: trimmed });
  if (error) {
    if (error.code === "23505") throw new Error("Ce pseudo est déjà pris.");
    throw error;
  }
  await refreshFromSession();
}

export async function updateUsername(username) {
  const trimmed = username.trim().toLowerCase();
  if (!USERNAME_RE.test(trimmed)) {
    throw new Error("Le pseudo doit faire 3 à 24 caractères : lettres minuscules, chiffres, underscore.");
  }
  const { error } = await supabase.from("profiles").update({ username: trimmed }).eq("id", currentProfile.id);
  if (error) {
    if (error.code === "23505") throw new Error("Ce pseudo est déjà pris.");
    throw error;
  }
  await refreshFromSession();
}

export async function setDeveloper(enabled) {
  const { error } = await supabase.from("profiles").update({ is_developer: enabled }).eq("id", currentProfile.id);
  if (error) throw error;
  await refreshFromSession();
}

// Cropping is a plain <canvas> square-crop at a fixed output size — no
// image-editing library added just for this. The user drags to
// reposition within a fixed square viewport; uploadAvatar receives the
// already-cropped Blob.
export async function uploadAvatar(blob) {
  // Folder-per-user path, not a flat filename — the storage RLS policies
  // (accounts_marketplace_migration.sql) check
  // (storage.foldername(name))[1] = auth.uid(), which is Supabase's own
  // documented convention for per-user storage folders. A flat
  // "{id}.jpg" path has zero folder segments, so that check would never
  // match and every upload would be silently rejected by RLS.
  const path = `${currentProfile.id}/avatar.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  // Cache-bust: same path every time, browsers/CDN would otherwise keep
  // showing the previous avatar after a re-upload.
  const bustedUrl = `${data.publicUrl}?t=${Date.now()}`;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: bustedUrl })
    .eq("id", currentProfile.id);
  if (updateError) throw updateError;
  await refreshFromSession();
}

// --------------------------------------------------------------- devices

export async function listDevices() {
  const { data, error } = await supabase.from("devices").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function renameDevice(id, name) {
  const { error } = await supabase.from("devices").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function attachDevice(code, name) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Pas connecté.");
  const { error } = await supabase
    .from("devices")
    .upsert({ owner_id: session.user.id, pairing_code: code, name }, { onConflict: "pairing_code" });
  if (error) throw error;
}

// ------------------------------------------------------------ UI render

function avatarImg(profile, size) {
  const img = document.createElement("img");
  img.width = size;
  img.height = size;
  img.style.borderRadius = "50%";
  img.style.objectFit = "cover";
  img.style.background = "#333";
  img.src = profile?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=${profile?.id ?? "anon"}`;
  img.alt = profile?.username ?? "Profil";
  return img;
}

// Mounts the account bar into the given container element. Kept
// framework-free (direct DOM) like the rest of this static site.
export function renderAccountBar(container) {
  async function render() {
    container.innerHTML = "";
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const btn = document.createElement("button");
      btn.className = "btn account-login-btn";
      btn.textContent = "Se connecter avec Google";
      btn.onclick = signInWithGoogle;
      container.appendChild(btn);
      return;
    }

    if (!currentProfile) {
      // Signed in with Google but no profile row yet — first-time
      // onboarding: ask for a username before anything else works
      // (mandatory before publishing anything, per the explicit request).
      const wrap = document.createElement("div");
      wrap.className = "account-onboarding";
      const label = document.createElement("span");
      label.textContent = "Choisis un pseudo public :";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "pseudo_unique";
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Valider";
      const err = document.createElement("span");
      err.className = "account-error";
      btn.onclick = async () => {
        err.textContent = "";
        try {
          await claimUsername(input.value);
        } catch (e) {
          err.textContent = e.message || String(e);
        }
      };
      wrap.append(label, input, btn, err);
      container.appendChild(wrap);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "account-bar";
    const avatar = avatarImg(currentProfile, 32);
    avatar.className = "account-avatar";
    const menu = document.createElement("div");
    menu.className = "account-menu";
    menu.hidden = true;

    const info = document.createElement("div");
    info.className = "account-menu-header";
    info.textContent = `@${currentProfile.username}`;
    menu.appendChild(info);

    const devicesLink = document.createElement("a");
    devicesLink.href = "/controlremote";
    devicesLink.textContent = "Mes appareils";
    menu.appendChild(devicesLink);

    if (currentProfile.is_developer) {
      const devLink = document.createElement("a");
      devLink.href = "/dev";
      devLink.textContent = "Espace développeur";
      menu.appendChild(devLink);
    }

    const signOutBtn = document.createElement("button");
    signOutBtn.textContent = "Se déconnecter";
    signOutBtn.onclick = signOut;
    menu.appendChild(signOutBtn);

    avatar.onclick = () => {
      menu.hidden = !menu.hidden;
    };
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) menu.hidden = true;
    });

    wrap.append(avatar, menu);
    container.appendChild(wrap);
  }

  // onProfileChange already both renders immediately (it calls the
  // listener once with the current value on subscribe) and re-renders on
  // every future auth/profile change — no separate onAuthStateChange
  // listener or manual render() call needed here too.
  onProfileChange(render);
}
