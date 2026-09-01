// Shared account bar (login/profile/devices/dev toggle) — loaded by every
// site page (index/extensions/extension/dev/docs/controlremote) so the same
// "logged in as..." state and dropdown appears everywhere, not just one
// page. Plain ESM, no bundler (same zero-build philosophy as the rest of
// site/).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://cihuwuiyziarnghethbi.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { SUPABASE_URL, SUPABASE_ANON_KEY };

const AVATAR_BUCKET = "avatars";
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

let currentProfile = null; // { id, username, avatar_url, is_developer } | null
let currentSession = null;
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

export function getSession() {
  return currentSession;
}

// The Google avatar Supabase already gives us for free on OAuth sign-in
// (session.user.user_metadata.avatar_url, sometimes .picture instead
// depending on the provider payload shape) — used as the default profile
// picture instead of a generated dicebear identicon, per explicit request
// ("logo repris de compte google pas de généré"). A custom uploaded avatar
// (profiles.avatar_url) always takes priority once one exists.
export function googleAvatarUrl(session) {
  const meta = session?.user?.user_metadata;
  return meta?.avatar_url || meta?.picture || null;
}

export function avatarUrlFor(profile, session) {
  return (
    profile?.avatar_url ||
    googleAvatarUrl(session) ||
    `https://api.dicebear.com/9.x/identicon/svg?seed=${profile?.id ?? "anon"}`
  );
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
  currentSession = session ?? null;
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
// "logged out" — renderAccountBar below handles that distinction. The
// Google avatar/display name are used as sensible defaults so a fresh
// account isn't blank even before the user visits "Notre compte".
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
    .insert({ id: session.user.id, username: trimmed, avatar_url: googleAvatarUrl(session) });
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

// Square-crop-to-center + downscale, plain <canvas> — no interactive
// drag-to-reposition UI, but still a real crop rather than "upload
// whatever dimensions". Shared by the account modal below and dev.html's
// extension thumbnail upload (same helper, exported so it isn't
// duplicated).
export function cropToSquareBlob(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Échec du recadrage"))), "image/jpeg", 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
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

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "account-js-styles";
  // New classes only — the pages that already embed .account-bar/
  // .account-menu/.account-avatar/etc. keep styling those themselves, this
  // only covers what's new for v0.7 (dev toggle row, "Notre compte" modal,
  // red sign-out) so nothing here can conflict with a page's own CSS.
  style.textContent = `
    .account-menu-dev-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 8px; border-radius: 6px; font-size: 0.85rem;
    }
    .account-switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
    .account-switch input { opacity: 0; width: 0; height: 0; }
    .account-switch-track {
      position: absolute; inset: 0; background: var(--border, #23272e); border-radius: 20px;
      transition: background 0.2s ease; cursor: pointer;
    }
    .account-switch-thumb {
      position: absolute; left: 3px; top: 3px; width: 14px; height: 14px;
      background: #ffffff; border-radius: 50%;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .account-switch input:checked + .account-switch-track { background: var(--accent-strong, #4c86e0); }
    .account-switch input:checked + .account-switch-track .account-switch-thumb { transform: translateX(16px); }
    .account-signout-btn { color: #e08a8a !important; font-weight: 600; }
    .account-menu-divider { border-top: 1px solid var(--border, #23272e); margin: 4px 0; }
    /* index.html/controlremote.html declare .account-menu { display: flex }
       in their own <style> block (predates account.js being shared) — an
       author-level "display" always beats the browser's default
       [hidden] { display: none } rule regardless of selector specificity
       (origin outranks specificity in the CSS cascade), so setting
       menu.hidden = true in JS was silently not hiding it at all on those
       two pages. Higher-specificity author rule here wins over the plain
       .account-menu class rule and actually closes it. */
    .account-menu[hidden] { display: none; }
    .account-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center; z-index: 100;
      animation: account-fade-in 0.15s ease;
    }
    @keyframes account-fade-in { from { opacity: 0; } to { opacity: 1; } }
    .account-modal {
      background: var(--bg-raised, #14171b); border: 1px solid var(--border, #23272e);
      border-radius: 14px; padding: 24px; width: min(400px, calc(100vw - 40px));
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .account-modal h3 { margin: 0 0 16px; font-size: 1.05rem; }
    .account-modal .avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .account-modal .avatar-row img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border, #23272e); }
    .account-modal label { display: block; font-size: 0.82rem; color: var(--text-dim, #9aa0a6); margin: 10px 0 4px; }
    .account-modal input[type="text"] {
      width: 100%; background: var(--bg, #0b0d10); border: 1px solid var(--border, #23272e);
      color: var(--text, #e8eaed); border-radius: 8px; padding: 9px 10px; font-size: 0.9rem;
    }
    .account-modal .status { font-size: 0.82rem; min-height: 1.2em; margin-top: 8px; }
    .account-modal .status-error { color: #e08a8a; }
    .account-modal .status-ok { color: #7fd0a0; }
    .account-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  `;
  document.head.appendChild(style);
}

function avatarImg(profile, size, session) {
  const img = document.createElement("img");
  img.width = size;
  img.height = size;
  img.style.borderRadius = "50%";
  img.style.objectFit = "cover";
  img.style.background = "#333";
  img.src = avatarUrlFor(profile, session ?? currentSession);
  img.alt = profile?.username ?? "Profil";
  return img;
}

// "Notre compte" modal — pseudo + photo de profil, usable by any logged-in
// user (not just developers, unlike the old dev.html-only editing). Kept
// inside account.js rather than duplicated per page so every page that
// mounts the account bar gets it for free.
function openAccountModal() {
  ensureStyles();
  const overlay = document.createElement("div");
  overlay.className = "account-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = document.createElement("div");
  modal.className = "account-modal";
  modal.innerHTML = `
    <h3>Notre compte</h3>
    <div class="avatar-row">
      <img id="acc-modal-avatar" alt="Avatar" />
      <div>
        <input type="file" id="acc-modal-avatar-input" accept="image/*" />
        <div class="status" id="acc-modal-avatar-status"></div>
      </div>
    </div>
    <label>Pseudo public</label>
    <input type="text" id="acc-modal-username" />
    <div class="status" id="acc-modal-username-status"></div>
    <div class="account-modal-actions">
      <button class="btn" id="acc-modal-close">Fermer</button>
      <button class="btn btn-primary" id="acc-modal-save">Enregistrer le pseudo</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const avatarPreview = modal.querySelector("#acc-modal-avatar");
  const avatarInput = modal.querySelector("#acc-modal-avatar-input");
  const avatarStatus = modal.querySelector("#acc-modal-avatar-status");
  const usernameInput = modal.querySelector("#acc-modal-username");
  const usernameStatus = modal.querySelector("#acc-modal-username-status");

  avatarPreview.src = avatarUrlFor(currentProfile, currentSession);
  usernameInput.value = currentProfile?.username ?? "";

  function setStatus(el, text, ok) {
    el.textContent = text;
    el.className = "status " + (ok === true ? "status-ok" : ok === false ? "status-error" : "");
  }

  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    setStatus(avatarStatus, "Envoi…");
    try {
      const blob = await cropToSquareBlob(file);
      await uploadAvatar(blob);
      avatarPreview.src = avatarUrlFor(currentProfile, currentSession);
      setStatus(avatarStatus, "Photo mise à jour.", true);
    } catch (e) {
      setStatus(avatarStatus, e.message || String(e), false);
    }
  });

  modal.querySelector("#acc-modal-save").addEventListener("click", async () => {
    setStatus(usernameStatus, "Enregistrement…");
    try {
      await updateUsername(usernameInput.value);
      setStatus(usernameStatus, "Pseudo mis à jour.", true);
    } catch (e) {
      setStatus(usernameStatus, e.message || String(e), false);
    }
  });

  modal.querySelector("#acc-modal-close").addEventListener("click", () => overlay.remove());
}

// Mounts the account bar into the given container element. Kept
// framework-free (direct DOM) like the rest of this static site.
export function renderAccountBar(container) {
  // render() recreates the whole bar (including a fresh outside-click
  // listener) on every profile change (login, dev toggle, avatar
  // upload...) — without tracking and removing the previous listener,
  // each re-render would leave a stale one attached to `document` forever
  // (harmless since it only touches an already-detached menu, but real
  // accumulating cruft over a session with several profile changes).
  let removeOutsideClickListener = null;

  async function render() {
    ensureStyles();
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
    const avatar = avatarImg(currentProfile, 32, session);
    avatar.className = "account-avatar";
    const menu = document.createElement("div");
    menu.className = "account-menu";
    menu.hidden = true;

    const info = document.createElement("div");
    info.className = "account-menu-header";
    info.textContent = `@${currentProfile.username}`;
    menu.appendChild(info);

    const accountBtn = document.createElement("button");
    accountBtn.textContent = "Notre compte";
    accountBtn.onclick = () => {
      menu.hidden = true;
      openAccountModal();
    };
    menu.appendChild(accountBtn);

    const devicesLink = document.createElement("a");
    devicesLink.href = "/controlremote";
    devicesLink.textContent = "Mes appareils";
    menu.appendChild(devicesLink);

    const divider1 = document.createElement("div");
    divider1.className = "account-menu-divider";
    menu.appendChild(divider1);

    // Dev-mode toggle lives directly in the dropdown now (rather than only
    // being reachable by first opening /dev) — flipping it on immediately
    // reveals the "Espace développeur" link right below it, no page
    // navigation needed to discover it exists.
    const devRow = document.createElement("label");
    devRow.className = "account-menu-dev-row";
    devRow.innerHTML = `
      <span>Mode développeur</span>
      <span class="account-switch">
        <input type="checkbox" />
        <span class="account-switch-track"><span class="account-switch-thumb"></span></span>
      </span>
    `;
    const devCheckbox = devRow.querySelector("input");
    devCheckbox.checked = !!currentProfile.is_developer;
    devCheckbox.addEventListener("click", (e) => e.stopPropagation());
    devCheckbox.addEventListener("change", async () => {
      const desired = devCheckbox.checked;
      try {
        await setDeveloper(desired);
      } catch {
        devCheckbox.checked = !desired;
      }
    });
    menu.appendChild(devRow);

    if (currentProfile.is_developer) {
      const devLink = document.createElement("a");
      devLink.href = "/dev";
      devLink.textContent = "Espace développeur";
      menu.appendChild(devLink);
    }

    const divider2 = document.createElement("div");
    divider2.className = "account-menu-divider";
    menu.appendChild(divider2);

    const signOutBtn = document.createElement("button");
    signOutBtn.className = "account-signout-btn";
    signOutBtn.textContent = "Se déconnecter";
    signOutBtn.onclick = signOut;
    menu.appendChild(signOutBtn);

    // Re-clicking the avatar toggles the menu closed again — this handler
    // fires first (avatar is the event target), setting menu.hidden back
    // to true before the click ever bubbles up to the document listener
    // below, whose `wrap.contains(e.target)` check (true here, the avatar
    // is inside wrap) means it leaves that result alone rather than
    // fighting it.
    avatar.onclick = () => {
      menu.hidden = !menu.hidden;
    };
    removeOutsideClickListener?.();
    const onOutsideClick = (e) => {
      if (!wrap.contains(e.target)) menu.hidden = true;
    };
    document.addEventListener("click", onOutsideClick);
    removeOutsideClickListener = () => document.removeEventListener("click", onOutsideClick);

    wrap.append(avatar, menu);
    container.appendChild(wrap);
  }

  // onProfileChange already both renders immediately (it calls the
  // listener once with the current value on subscribe) and re-renders on
  // every future auth/profile change — no separate onAuthStateChange
  // listener or manual render() call needed here too.
  onProfileChange(render);
}
