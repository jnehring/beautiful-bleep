// SPDX-License-Identifier: MIT
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useUser } from "@/lib/auth";

type Rating = { average: number | null; count: number; mine: number | null };
type Comment = { id: number; user_id: number; author: string; body: string; created_at: string; mine: boolean };
type Comments = { items: Comment[]; total: number; page: number; page_size: number };

/** Path of an entry's social endpoints. Preset slugs are `author/slug`, so the slash stays a slash. */
const base = (kind: string, slug: string) => `/social/${kind}/${slug.split("/").map(encodeURIComponent).join("/")}`;

export function Stars({ average, count }: { average: number | null; count: number }) {
  if (!count || average === null) return <small className="muted">no ratings yet</small>;
  return <small title={`${average.toFixed(1)} of 5`}><span aria-hidden="true">★</span> {average.toFixed(1)} <span className="muted">({count})</span></small>;
}

/** Rating and comments of one store entry. Reading is public; rating and commenting need a login. */
export function Social({ kind, slug }: { kind: string; slug: string }) {
  const user = useUser();
  const path = base(kind, slug);
  const [rating, setRating] = useState<Rating | null>(null);
  const [comments, setComments] = useState<Comments | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [text, setText] = useState("");

  const load = useCallback(() => {
    api<Rating>("GET", `${path}/rating`).then(setRating, (e) => setError(e.message));
    api<Comments>("GET", `${path}/comments?page=${page}`).then(setComments, (e) => setError(e.message));
  }, [path, page]);
  useEffect(load, [load, user]);

  const act = async (run: () => Promise<unknown>) => {
    setError("");
    try { await run(); load(); } catch (e) { setError((e as Error).message); }
  };
  const rate = (stars: number) => act(async () => setRating(rating?.mine === stars
    ? await api<Rating>("DELETE", `${path}/rating`) : await api<Rating>("PUT", `${path}/rating`, { stars })));
  const post = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => { await api("POST", `${path}/comments`, { body: text }); setText(""); setPage(1); });
  };
  const pages = comments ? Math.max(1, Math.ceil(comments.total / comments.page_size)) : 1;

  return (
    <section className="social" aria-label="Ratings and comments">
      <h2>Rating</h2>
      {rating && <p><Stars average={rating.average} count={rating.count} /></p>}
      {user ? (
        <div role="group" aria-label="Your rating" className="rate">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={rating?.mine === n} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} onClick={() => rate(n)}>
              {(rating?.mine ?? 0) >= n ? "★" : "☆"}
            </button>
          ))}
          <small className="muted">{rating?.mine ? "Your rating (click it again to remove)" : "Rate it"}</small>
        </div>
      ) : user === null && <p className="muted"><a href="/login/">Log in</a> to rate and comment.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Comments {comments && <small className="muted">({comments.total})</small>}</h2>
      {user && (
        <form onSubmit={post} className="comment-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder="Write a comment" aria-label="Write a comment" required />
          <button type="submit">Post</button>
        </form>
      )}
      {comments && comments.items.length === 0 && <p className="muted">No comments yet.</p>}
      <ul className="comments">
        {comments?.items.map((c) => (
          <li key={c.id}>
            <p><strong>{c.author}</strong> <small className="muted">{c.created_at.slice(0, 10)}</small></p>
            <p className="comment-body">{c.body}</p>
            <p>
              {(c.mine || user?.role === "admin") && <button type="button" className="linklike" onClick={() => act(() => api("DELETE", `/social/comments/${c.id}`))}>Delete</button>}
              {!c.mine && <button type="button" className="linklike" onClick={() => act(async () => { await api("POST", `/social/comments/${c.id}/report`, { reason: "" }); setError("Reported. Thank you."); })}>Report</button>}
            </p>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="pager" aria-label="Comment pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older →</button>
        </nav>
      )}
    </section>
  );
}
