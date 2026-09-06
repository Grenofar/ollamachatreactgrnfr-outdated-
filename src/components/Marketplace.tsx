import { useEffect, useState } from "react";
import { importMarketplaceExtension } from "../api";
import { isExpired, loadSession, SUPABASE_ANON_KEY, SUPABASE_URL, type Session } from "../account";

// The site's marketplace, inside the app. Same data, same public read
// access — the point is not having to leave the app to find an extension,
// and being able to read what other people thought of it first.
interface MarketExtension {
  id: string;
  name: string;
  description: string;
  summary: string | null;
  thumbnail_url: string | null;
  is_official: boolean;
  page_view_count: number | null;
  install_click_count: number | null;
  profiles?: { username: string | null } | null;
}

interface Review {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  author_id: string;
  profiles?: { username: string | null } | null;
}

function anonHeaders(): HeadersInit {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}

function authHeaders(session: Session): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export default function Marketplace() {
  const [items, setItems] = useState<MarketExtension[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      `${SUPABASE_URL}/rest/v1/extensions?select=id,name,description,summary,thumbnail_url,is_official,page_view_count,install_click_count,profiles(username)&order=install_click_count.desc.nullslast`,
      { headers: anonHeaders() },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`Marketplace injoignable (${r.status})`);
        return (await r.json()) as MarketExtension[];
      })
      .then(setItems)
      .catch((e) => {
        setError(String(e instanceof Error ? e.message : e));
        setItems([]);
      });
  }, []);

  async function openExtension(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setReviews(null);
    setStatus(null);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/extension_reviews?extension_id=eq.${encodeURIComponent(id)}&select=id,rating,comment,created_at,author_id,profiles(username)&order=created_at.desc`,
        { headers: anonHeaders() },
      );
      // The reviews table arrives with its own migration; until it is run,
      // say so plainly instead of showing an empty list that looks like
      // "nobody reviewed this".
      if (!res.ok) throw new Error("Les avis ne sont pas encore disponibles (migration SQL à exécuter).");
      setReviews((await res.json()) as Review[]);
    } catch (e) {
      setReviews([]);
      setStatus(String(e instanceof Error ? e.message : e));
    }
  }

  async function submitReview(extensionId: string) {
    const session = loadSession();
    if (!session || isExpired(session)) {
      setStatus("Connecte-toi pour laisser un avis (Réglages > Compte).");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // upsert: one review per person per extension is enforced by a unique
      // constraint, so re-reviewing edits the existing one rather than
      // failing.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/extension_reviews?on_conflict=extension_id,author_id`, {
        method: "POST",
        headers: { ...authHeaders(session), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          extension_id: extensionId,
          author_id: session.user_id,
          rating,
          comment: comment.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Avis refusé (${res.status})`);
      setComment("");
      setStatus("Avis enregistré.");
      await openExtension(extensionId);
      setOpenId(extensionId);
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function install(id: string) {
    if (
      !window.confirm(
        "Fais-tu confiance à ce créateur ? Une extension non officielle n'a été vérifiée que par une IA, pas par une personne — l'installer se fait à tes risques et périls. Installer maintenant ?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await importMarketplaceExtension(id);
      setStatus("Installée. Retrouve-la dans l'espace Skills.");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  const filtered = (items ?? []).filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${e.name} ${e.description} ${e.summary ?? ""}`.toLowerCase().includes(q);
  });

  const average = (list: Review[]) =>
    list.length === 0 ? null : (list.reduce((a, r) => a + r.rating, 0) / list.length).toFixed(1);

  return (
    <div className="marketplace">
      <input
        className="extensions-search"
        placeholder="Rechercher une extension…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <div className="banner banner-error">{error}</div>}
      {items === null ? (
        <div className="audio-status">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="audio-status">Aucune extension trouvée.</div>
      ) : (
        <div className="market-grid">
          {filtered.map((e) => (
            <div key={e.id} className="market-card">
              <div className="market-card-head">
                <span className="market-card-name">{e.name}</span>
                <span className={e.is_official ? "market-badge-official" : "market-badge-unofficial"}>
                  {e.is_official ? "Officielle" : "Non officielle"}
                </span>
              </div>
              <div className="market-card-summary">{e.summary || e.description}</div>
              <div className="market-card-meta">
                <span>par {e.profiles?.username ?? "anonyme"}</span>
                <span>{e.page_view_count ?? 0} impressions</span>
                <span>{e.install_click_count ?? 0} ajouts</span>
              </div>
              <div className="audio-row">
                <button onClick={() => void openExtension(e.id)}>
                  {openId === e.id ? "Masquer les avis" : "Voir les avis"}
                </button>
                <button className="primary-btn" onClick={() => void install(e.id)} disabled={busy}>
                  Ajouter
                </button>
              </div>

              {openId === e.id && (
                <div className="market-reviews">
                  {reviews === null ? (
                    <div className="audio-status">Chargement des avis…</div>
                  ) : (
                    <>
                      <div className="modal-hint">
                        {reviews.length === 0
                          ? "Aucun avis pour l'instant."
                          : `${average(reviews)} sur 5 — ${reviews.length} avis`}
                      </div>
                      {reviews.map((r) => (
                        <div key={r.id} className="market-review">
                          <div className="market-review-head">
                            <span>{"★".repeat(r.rating)}</span>
                            <span className="modal-hint">{r.profiles?.username ?? "anonyme"}</span>
                          </div>
                          {r.comment && <div>{r.comment}</div>}
                        </div>
                      ))}
                      <label>Ton avis</label>
                      <div className="audio-row">
                        <select value={rating} onChange={(ev) => setRating(Number(ev.target.value))}>
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {"★".repeat(n)}
                            </option>
                          ))}
                        </select>
                        <input
                          value={comment}
                          onChange={(ev) => setComment(ev.target.value)}
                          placeholder="Ce que tu en penses (facultatif)"
                        />
                        <button onClick={() => void submitReview(e.id)} disabled={busy}>
                          Publier
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {status && <div className="audio-status">{status}</div>}
    </div>
  );
}
