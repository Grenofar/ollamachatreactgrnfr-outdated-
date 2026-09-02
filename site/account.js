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

// Any text/URL stored by another user (extension name/description/summary/
// thumbnail_url, a device name, etc.) is untrusted the moment it's read
// back and interpolated into an innerHTML template — DB constraints don't
// stop someone from setting extensions.name to "<img src=x onerror=...>"
// via a direct API call, RLS only checks who's allowed to write a row, not
// what's in it. Escaping via the browser's own textContent → innerHTML
// round-trip (correct per the HTML spec, no regex to get subtly wrong)
// before any such value goes into innerHTML/an attribute is what actually
// stops that, not the never-a-real-risk-here SQL injection angle (every
// query in this project goes through the parameterized supabase-js query
// builder, values are always sent as separate parameters, never
// string-concatenated into a query).
export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
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

    /* -------------------------------------------------- site-wide polish
       Every page loads account.js, so this is the one place that reaches
       all of them without duplicating the same rules six times. Later in
       the cascade than each page's own <head> <style> (appended at
       runtime), and at equal specificity for plain element/class
       selectors that ties resolve in source order — so these intentionally
       override a page's own flat "body { background: var(--bg) }" already
       declared everywhere, without needing !important. */
    body {
      background: radial-gradient(ellipse 1200px 600px at 50% -10%, #182029 0%, var(--bg, #0b0d10) 55%);
      background-attachment: fixed;
    }
    a, .btn, button {
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease,
        transform 0.12s ease, box-shadow 0.15s ease, opacity 0.15s ease;
    }
    .btn:hover:not(:disabled), button:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    .btn:active:not(:disabled), button:active:not(:disabled) {
      transform: translateY(0) scale(0.97);
    }
    .btn-primary:hover:not(:disabled) {
      box-shadow: 0 4px 16px rgba(78, 138, 240, 0.35);
    }
    /* Plain <a> text used as a primary action reads as a dead link at a
       glance — anywhere a page marks one with .link-btn it gets the same
       pill treatment as .btn without needing that class's full JS wiring
       (autostart/disabled state etc. that some real buttons carry). */
    .link-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 8px;
      border: 1px solid var(--border, #23272e);
      background: var(--bg-raised, #14171b);
      color: var(--text, #e8eaed) !important;
      text-decoration: none; font-size: 0.85rem;
    }
    .link-btn:hover { border-color: var(--accent, #6ea8fe); }

    html { scroll-behavior: smooth; }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

    /* Diagonal light sweep across primary buttons on hover — a small,
       common "premium SaaS" touch (a highlight band that travels left to
       right), layered on top of the existing color/lift transitions
       rather than replacing them. */
    .btn-primary {
      position: relative;
      overflow: hidden;
    }
    .btn-primary::after {
      content: "";
      position: absolute;
      top: 0; left: -60%;
      width: 40%; height: 100%;
      background: linear-gradient(115deg, transparent, rgba(255, 255, 255, 0.35), transparent);
      transform: skewX(-20deg);
      transition: left 0.6s ease;
      pointer-events: none;
    }
    .btn-primary:hover::after { left: 130%; }

    /* Cursor-follow glow on cards (extension grid, flow/explainer items) —
       a soft radial highlight that tracks the pointer, opacity 0 until
       hovered. mountCardGlow (below) sets --mx/--my per pointer move;
       cheap (one repaint of a pseudo-element, no layout) and skipped
       entirely under reduced-motion. */
    .card-glow { position: relative; overflow: hidden; }
    .card-glow::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 0;
      opacity: 0;
      background: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent, #6ea8fe) 16%, transparent), transparent 70%);
      transition: opacity 0.25s ease;
    }
    .card-glow:hover::before { opacity: 1; }
    .card-glow > * { position: relative; z-index: 1; }
    @media (prefers-reduced-motion: reduce) {
      .card-glow::before { display: none; }
      .btn-primary::after { display: none; }
    }

    /* Subtle grain over the whole page — the "premium SaaS" texture used
       by sites like Linear/Vercel to keep a flat dark background from
       looking dead flat, without an image asset: a tiny inline SVG
       feTurbulence noise, tiled, at very low opacity, screen-blended so
       it only ever lightens (never muddies text contrast). */
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 999;
      pointer-events: none;
      opacity: 0.035;
      mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }

    /* Glassmorphism on every .note/info panel (each page declares its own
       opaque version) — frosted-glass over the animated background looks
       far better than a flat opaque card sitting on top of it, same
       backdrop-filter technique already used for the sticky header.
       color-mix against --bg-raised (not a hardcoded rgba) keeps the tint
       correct in both themes automatically. */
    .note {
      background: color-mix(in srgb, var(--bg-raised) 65%, transparent) !important;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    /* Magnetic pull on primary buttons — the button nudges a few pixels
       toward the cursor while hovered (mountMagnetic below sets --tx/--ty
       per pointer move) instead of staying rigidly still, a small but
       recognizable "premium" interaction (Linear/Vercel/Stripe-style
       marketing CTAs). Capped low (see JS) so it reads as responsive, not
       like the button is chasing the cursor around. */
    .magnetic {
      transform: translate(var(--tx, 0), var(--ty, 0));
      transition: transform 0.15s ease-out;
    }
    .magnetic:active { transition: transform 0.05s ease-out; }
    @media (prefers-reduced-motion: reduce) {
      .magnetic { transform: none !important; }
    }
    /* Hero content (above the fold, visible immediately) still animates in
       on load — below-the-fold content uses .reveal + mountScrollReveal
       instead (see further down), triggered by actually scrolling into
       view rather than firing for everything at once on load. */
    .hero, .hero * {
      animation: site-fade-up 0.5s var(--ease-out, ease) both;
    }
    @keyframes site-fade-up {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    /* Mobile gets a deliberately different header, not just a squeezed
       desktop one: nav link labels collapse behind a single compact menu
       button instead of wrapping/crowding the header next to the account
       avatar and install button. */
    @media (max-width: 640px) {
      .site-nav { display: none; }
      .site-header-inner { gap: 10px; }
      .site-header-actions .btn { padding: 7px 12px; font-size: 0.8rem; }
      .mobile-nav-toggle {
        display: inline-flex !important;
        align-items: center; justify-content: center;
        width: 34px; height: 34px; border-radius: 8px;
        border: 1px solid var(--border, #23272e);
        background: var(--bg-raised, #14171b);
        color: var(--text, #e8eaed);
        font-size: 1rem; cursor: pointer;
      }
      .mobile-nav-menu {
        position: absolute; top: 100%; left: 0; right: 0;
        background: var(--bg-raised, #14171b);
        border-bottom: 1px solid var(--border, #23272e);
        display: flex; flex-direction: column; padding: 8px 20px;
      }
      /* Same cascade-origin gotcha as .account-menu above: an author-level
         "display" beats the browser's default [hidden] rule regardless of
         specificity, so this needs its own explicit override too. */
      .mobile-nav-menu[hidden] { display: none; }
      .mobile-nav-menu a {
        padding: 12px 4px; color: var(--text, #e8eaed); text-decoration: none;
        border-bottom: 1px solid var(--border, #23272e); font-size: 0.9rem;
      }
      .mobile-nav-menu a:last-child { border-bottom: none; }
    }
    .mobile-nav-toggle { display: none; }

    /* ---------------------------------------------------------- theming
       Every page already declares --bg/--bg-raised/--border/--text/
       --text-dim/--accent/--accent-strong/--warn (and some also --danger/
       --ok) as custom properties on a bare :root — this light palette
       overrides all of them at once from here rather than duplicating it
       six times, matching by selector specificity ([data-theme="light"]
       is (0,1,0), same as a page's own [data-theme="dark"] block where one
       exists, both beat a bare :root's (0,0,1) regardless of injection
       order). Values match what index.html's own light override already
       used pre-v0.7 so the toggle doesn't introduce a new, unreviewed
       palette on that page.
       Kept last-of-file so no more specific rule anywhere above can
       accidentally out-rank it for these variable names. */
    :root[data-theme="light"] {
      --bg: #f7f8fa;
      --bg-raised: #ffffff;
      --border: #e2e5e9;
      --text: #1c1e21;
      --text-dim: #5f6570;
      --accent: #2f6fed;
      --accent-strong: #2857c4;
      --warn: #9a6b17;
      --danger: #c23f3f;
      --ok: #1f7a4d;
    }
    body {
      transition: background-color 0.3s ease, color 0.3s ease;
    }
    /* extensions.html/extension.html/dev.html hardcode .badge-official/
       .badge-unofficial backgrounds as fixed dark colors (#1f3a24/#3a2f1f)
       with only the text color themed via var(--ok)/var(--warn) — fine
       against the dark palette these were written for, but in light mode
       the same fixed dark background paired with the light palette's much
       darker --ok/--warn text (chosen for contrast on a LIGHT page
       background) becomes near-illegible dark-on-dark. Deriving the
       background as a translucent tint of the same variable via
       color-mix keeps foreground/background paired to the same color in
       both themes, correct contrast either way, one shared fix instead of
       patching three pages' hardcoded hex values individually. */
    .badge-official { background: color-mix(in srgb, var(--ok, #7fd0a0) 20%, transparent) !important; }
    .badge-unofficial { background: color-mix(in srgb, var(--warn, #e0b666) 20%, transparent) !important; }
    /* Same fix, same reason, for every other place that pairs a fixed
       #1c2634 background with color: var(--accent) — .badge-target
       (extension.html), .memory-category/.remote-step (controlremote.html). */
    .badge-target, .memory-category, .remote-step {
      background: color-mix(in srgb, var(--accent, #6ea8fe) 20%, transparent) !important;
    }

    /* Plain custom properties are NOT smoothly animatable by default —
       without registering their syntax, the browser treats each
       @keyframes stop as a hard jump (no interpolation in between) rather
       than tweening the value, which is exactly why this drifted in
       visible steps instead of smoothly ("1 frame every 30s") before this
       was added. @property with a <percentage> syntax opts these into
       real interpolation, same fix applied in App.css for the app's own
       version of this background. Unsupported browsers just keep the
       old stepped behavior (graceful, not broken — @property has broad
       support by now regardless). */
    @property --blob1-x { syntax: '<percentage>'; inherits: false; initial-value: 15%; }
    @property --blob1-y { syntax: '<percentage>'; inherits: false; initial-value: 20%; }
    @property --blob2-x { syntax: '<percentage>'; inherits: false; initial-value: 85%; }
    @property --blob2-y { syntax: '<percentage>'; inherits: false; initial-value: 15%; }
    @property --blob3-x { syntax: '<percentage>'; inherits: false; initial-value: 50%; }
    @property --blob3-y { syntax: '<percentage>'; inherits: false; initial-value: 90%; }

    /* Animated mesh-style background: three soft radial blobs whose
       positions drift slowly (60s+ loops, barely perceptible frame to
       frame, never distracting) — layered radial-gradients is the
       standard pure-CSS mesh-gradient technique (no native CSS
       mesh-gradient exists yet). Sits behind body's own flat color via
       the pseudo-element so text contrast is completely unaffected;
       fixed positioning means it doesn't repaint on scroll. */
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      background:
        radial-gradient(38vw 38vw at var(--blob1-x, 15%) var(--blob1-y, 20%), color-mix(in srgb, var(--accent) 18%, transparent), transparent 70%),
        radial-gradient(34vw 34vw at var(--blob2-x, 85%) var(--blob2-y, 15%), color-mix(in srgb, var(--ok, #7fd0a0) 14%, transparent), transparent 70%),
        radial-gradient(42vw 42vw at var(--blob3-x, 50%) var(--blob3-y, 90%), color-mix(in srgb, var(--accent-strong) 14%, transparent), transparent 70%),
        var(--bg);
      background-repeat: no-repeat;
      animation: mesh-drift 50s ease-in-out infinite alternate;
    }
    @keyframes mesh-drift {
      0% { --blob1-x: 10%; --blob1-y: 15%; --blob2-x: 88%; --blob2-y: 10%; --blob3-x: 45%; --blob3-y: 95%; }
      50% { --blob1-x: 25%; --blob1-y: 35%; --blob2-x: 75%; --blob2-y: 30%; --blob3-x: 60%; --blob3-y: 80%; }
      100% { --blob1-x: 15%; --blob1-y: 10%; --blob2-x: 90%; --blob2-y: 25%; --blob3-x: 35%; --blob3-y: 92%; }
    }
    @supports not (background: color-mix(in srgb, red, blue)) {
      body::before { animation: none; background: var(--bg); }
    }

    /* ------------------------------------------------------ theme toggle
       A real switch, not a button whose icon swaps: a pill track with
       both faces (sun + moon) always present, and a round knob that
       physically slides between them — role="switch" + aria-checked for
       the same reason (semantics of a toggle, not a push button). */
    .theme-switch {
      position: relative;
      width: 56px; height: 28px;
      border-radius: 999px;
      border: 1px solid var(--border, #23272e);
      background: var(--bg-raised, #14171b);
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      transition: background 0.3s ease, border-color 0.3s ease, transform 0.12s ease;
    }
    .theme-switch:hover { border-color: var(--accent, #6ea8fe); }
    .theme-switch:active { transform: scale(0.96); }
    .theme-switch-icon {
      position: absolute;
      top: 50%;
      width: 14px; height: 14px;
      transform: translateY(-50%);
      display: flex; z-index: 2;
      transition: opacity 0.3s ease, color 0.3s ease;
    }
    .theme-switch-icon svg { width: 100%; height: 100%; }
    .theme-switch-icon-sun { left: 5px; color: #f0b03e; opacity: 0.45; }
    .theme-switch-icon-moon { right: 5px; color: #b9c6e0; opacity: 1; }
    .theme-switch-light .theme-switch-icon-sun { opacity: 1; }
    .theme-switch-light .theme-switch-icon-moon { opacity: 0.4; }
    .theme-switch-knob {
      position: absolute;
      top: 3px; left: 3px;
      width: 20px; height: 20px;
      border-radius: 50%;
      z-index: 1;
      background: linear-gradient(150deg, #3a4048, #1c1f24);
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
      transform: translateX(28px); /* default = dark = resting near the moon */
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.3s ease;
    }
    .theme-switch-light .theme-switch-knob {
      transform: translateX(0); /* light = resting near the sun */
      background: linear-gradient(150deg, #fff8ea, #ffe9b8);
    }
    ::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
    ::view-transition-new(root) { animation: theme-reveal 0.5s ease forwards; }
    @keyframes theme-reveal {
      from { clip-path: circle(0% at var(--theme-toggle-x, 100%) var(--theme-toggle-y, 0%)); }
      to { clip-path: circle(150% at var(--theme-toggle-x, 100%) var(--theme-toggle-y, 0%)); }
    }

    /* -------------------------------------------------- loading states
       Shimmering placeholder blocks for anything fetched async (stat
       numbers, extension grid, extension detail hero) — shown instead of
       a bare "—"/blank gap so the page never looks broken mid-load. */
    .skeleton {
      display: inline-block;
      background: linear-gradient(90deg, var(--bg-raised, #14171b) 25%, var(--border, #23272e) 50%, var(--bg-raised, #14171b) 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.4s ease-in-out infinite;
      border-radius: 6px;
      color: transparent !important;
    }
    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ------------------------------------------------ scroll reveal
       Purposeful, not constant motion: elements marked .reveal start
       faded/offset and animate in only once, the first time they cross
       into the viewport (IntersectionObserver, mountScrollReveal below) —
       deliberately not applied to everything on the page at once. */
    .reveal { opacity: 0; transform: translateY(16px); }
    .reveal.reveal-visible {
      animation: reveal-in 0.5s var(--ease-out, ease) forwards;
    }
    @keyframes reveal-in {
      to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      body::before { animation: none; }
      ::view-transition-new(root) { animation: none; }
      .reveal { opacity: 1; transform: none; }
      .reveal.reveal-visible { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

const THEME_STORAGE_KEY = "ollamachat_theme";

// Applied as early as possible by a tiny inline <script> in each page's
// <head> too (before this module even loads) to avoid a flash of the
// wrong theme on first paint — this export exists so that inline snippet
// and the toggle button below share the exact same read/apply logic
// instead of two copies drifting apart.
export function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    document.documentElement.dataset.theme = stored;
  }
}

// Crisp at any size, no emoji-font-rendering inconsistency across
// platforms — plain inline SVG paths instead, used by the switch below.
const SUN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>';
const MOON_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.2 14.9A8.5 8.5 0 1 1 9.1 3.8a7 7 0 0 0 11.1 11.1z"/></svg>';

// A real switch — track with both faces always present (sun/moon, so the
// two states are visible at a glance) and a round knob that slides
// between them — not a single button whose icon swaps, which read as a
// plain button rather than a toggle.
export function mountThemeToggle(container) {
  ensureStyles();
  applyStoredTheme();

  const btn = document.createElement("button");
  btn.className = "theme-switch";
  btn.type = "button";
  btn.setAttribute("aria-label", "Changer de thème");
  btn.innerHTML = `
    <span class="theme-switch-knob"></span>
    <span class="theme-switch-icon theme-switch-icon-sun">${SUN_SVG}</span>
    <span class="theme-switch-icon theme-switch-icon-moon">${MOON_SVG}</span>
  `;

  function currentTheme() {
    if (document.documentElement.dataset.theme === "light") return "light";
    if (document.documentElement.dataset.theme === "dark") return "dark";
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function paint() {
    btn.classList.toggle("theme-switch-light", currentTheme() === "light");
    btn.setAttribute("aria-checked", String(currentTheme() === "light"));
  }
  btn.setAttribute("role", "switch");
  paint();

  btn.addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    const rect = btn.getBoundingClientRect();
    document.documentElement.style.setProperty("--theme-toggle-x", `${rect.left + rect.width / 2}px`);
    document.documentElement.style.setProperty("--theme-toggle-y", `${rect.top + rect.height / 2}px`);

    const apply = () => {
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_STORAGE_KEY, next);
      paint();
    };
    // startViewTransition is Chromium-only (this site's two real audiences
    // — the Tauri app's WebView2, and most visitors' Chrome/Edge — both
    // have it) — everywhere else this just falls back to an instant swap,
    // still smoothed by the plain color transitions declared above.
    if (document.startViewTransition && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  });

  container.appendChild(btn);
}

// Observes every .reveal element currently in `root` (default: whole
// document) and adds .reveal-visible the first time each crosses into the
// viewport, then stops watching it — a one-shot entrance, not a
// scroll-position-linked animation. Call after the relevant DOM exists
// (including after any async render that adds more .reveal elements).
export function mountScrollReveal(root = document) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  root.querySelectorAll(".reveal:not(.reveal-visible)").forEach((el) => io.observe(el));
  return io;
}

// Animates a number counting up from 0 to `value` over `duration` ms —
// used for the landing page's live stats. Respects reduced-motion by
// jumping straight to the final value.
export function animateCounter(el, value, duration = 900) {
  const format = (n) => n.toLocaleString("fr-FR");
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = format(value);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(eased * value));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Adds the .card-glow class (see ensureStyles) plus a mousemove listener
// to every element matching `selector` under `root`, tracking the pointer
// into --mx/--my so the CSS radial-gradient highlight follows the cursor.
// Uses event delegation on `root` (one listener, not one per card) so it
// keeps working for cards added later (e.g. after an async fetch re-renders
// the grid) without needing to be called again.
export function mountCardGlow(root, selector) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  root.addEventListener("mousemove", (e) => {
    const card = e.target.closest?.(selector);
    if (!card || !root.contains(card)) return;
    card.classList.add("card-glow");
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    card.style.setProperty("--my", `${e.clientY - rect.top}px`);
  });
}

// Adds the .magnetic class plus a subtle cursor-pull to every element
// matching `selector` — nudges toward the pointer while hovered, capped at
// `strength` px so it reads as a responsive detail rather than the button
// visibly chasing the cursor. Same event-delegation approach as
// mountCardGlow, for the same reason (works for elements added later).
export function mountMagnetic(root, selector, strength = 10) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  root.addEventListener("mousemove", (e) => {
    const el = e.target.closest?.(selector);
    if (!el || !root.contains(el)) return;
    el.classList.add("magnetic");
    const rect = el.getBoundingClientRect();
    const relX = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const relY = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    el.style.setProperty("--tx", `${relX * strength}px`);
    el.style.setProperty("--ty", `${relY * strength}px`);
  });
  root.addEventListener(
    "mouseout",
    (e) => {
      const el = e.target.closest?.(selector);
      if (!el || el.contains(e.relatedTarget)) return;
      el.style.setProperty("--tx", "0px");
      el.style.setProperty("--ty", "0px");
    },
    true,
  );
}

// Collapses a desktop nav (an element matching navSelector, e.g. ".site-nav")
// into a single toggle button + dropdown on narrow viewports — called by
// pages that have a header nav (currently just index.html). Genuinely
// different mobile layout rather than the same links just wrapping/shrinking.
export function mountMobileNav(navEl) {
  if (!navEl || navEl.dataset.mobileNavMounted) return;
  navEl.dataset.mobileNavMounted = "1";
  ensureStyles();
  const links = Array.from(navEl.querySelectorAll("a"));
  if (links.length === 0) return;

  const toggle = document.createElement("button");
  toggle.className = "mobile-nav-toggle";
  toggle.setAttribute("aria-label", "Menu");
  toggle.textContent = "☰";

  const menu = document.createElement("div");
  menu.className = "mobile-nav-menu";
  menu.hidden = true;
  for (const link of links) {
    const clone = document.createElement("a");
    clone.href = link.href;
    clone.textContent = link.textContent;
    menu.appendChild(clone);
  }

  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!toggle.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
  });

  navEl.insertAdjacentElement("afterend", toggle);
  const header = toggle.closest("header") ?? toggle.parentElement;
  if (header) {
    header.style.position = header.style.position || "relative";
    header.appendChild(menu);
  }
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
