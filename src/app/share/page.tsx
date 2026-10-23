"use client";

/** PWA Web Share Target: a link shared from another app lands here and is imported into the box (CP02). */
import { useEffect, useState } from "react";

function firstWebUrl(...candidates: (string | null)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const m = /https?:\/\/[^\s]+/.exec(c);
    if (m) return m[0];
  }
  return null;
}

export default function SharePage() {
  const [message, setMessage] = useState<string>("Adding your recipe…");
  const [link, setLink] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const url = firstWebUrl(q.get("url"), q.get("text"), q.get("title"));
    // The no-link message waits one tick, after mount, so it is not set synchronously in the effect.
    if (!url) {
      void Promise.resolve().then(() => setMessage("Share a recipe link to add it to your box."));
      return;
    }
    fetch("/api/recipes/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) })
      .then(async (res) => {
        if (res.status === 401) return setMessage("Please sign in, then share the link again.");
        const body = (await res.json()) as { status: string; reason?: string; prefill?: { sourceUrl: string; title: string } };
        if (body.status === "ready") return (setMessage("Added to your recipe box."), setLink({ href: "/recipes", label: "Open your recipe box" }));
        if (body.status === "needs_review") return (setMessage("Added. A few details need your check."), setLink({ href: "/recipes/review", label: "Check the details" }));
        if (body.status === "manual") {
          const p = new URLSearchParams({ url: body.prefill?.sourceUrl ?? url });
          return (setMessage(body.reason ?? "Please enter this recipe by hand."), setLink({ href: `/recipes/manual?${p.toString()}`, label: "Enter the recipe" }));
        }
        return setMessage(body.reason ?? "We could not import this link.");
      })
      .catch(() => setMessage("We could not reach OneTable just now. Please try again."));
  }, []);

  return (
    <main>
      <p role="status">{message}</p>
      {link ? <p><a href={link.href}>{link.label}</a></p> : null}
    </main>
  );
}
