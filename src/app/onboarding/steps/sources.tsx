/**
 * WP-2.7 — ON01 step 5 "Where your food comes from" (PRD §5.3 CP04, §16.5).
 *
 * One paste box that accepts many links (platform detection happens on the
 * server, `/api/sources`), one card per source with a platform badge and a
 * live status chip, the one-time plain explanation for why social profiles
 * cannot be read, an "Add website" action on those cards, and a
 * "Skip for now: use our starter recipes" path that is always available.
 *
 * No fetch from this screen ever goes to a social domain (ADR-015): saving a
 * profile link is a pure database insert server-side.
 */

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OtCard, OtStatusChip } from "@/components/ui/base";
import { OtButton } from "@/components/ui/controls";
import { PLATFORM_LABEL, type SourceCard } from "@/lib/sources/cards";
import type { OnboardStep, OnboardingDraft } from "../store";

const EXPLAIN_KEY = "ot:s…ined";

/**
 * The one-time explanation visibility lives in localStorage, read through
 * useSyncExternalStore (same pattern as the onboarding root): SSR renders
 * "pending" (nothing shows), the client resolves "show" / "hide" on hydrate.
 * No setState inside an effect.
 */
const explainStore = (() => {
  const listeners = new Set<() => void>();
  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot(): "show" | "hide" {
      try {
        return window.localStorage.getItem(EXPLAIN_KEY) === null ? "show" : "hide";
      } catch {
        return "show"; // private mode: the explanation just shows again
      }
    },
    getServerSnapshot(): "show" | "hide" {
      return "hide";
    },
    set(value: "show" | "hide") {
      try {
        if (value === "hide") window.localStorage.setItem(EXPLAIN_KEY, "1");
        else window.localStorage.removeItem(EXPLAIN_KEY);
      } catch {
        /* ignore */
      }
      for (const cb of listeners) cb();
    },
  };
})();

export function Sources({
  draft,
  goTo,
  goBack,
}: {
  draft: OnboardingDraft;
  goTo: (n: OnboardStep) => void;
  goBack: () => void;
}) {
  const [links, setLinks] = useState("");
  const [cards, setCards] = useState<SourceCard[]>([]);
  const [rejected, setRejected] = useState<{ link: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [webFor, setWebFor] = useState<string | null>(null);
  const [webInput, setWebInput] = useState("");
  const [webBusy, setWebBusy] = useState(false);
  const loadedOnce = useRef(false);
  const showExplain = useSyncExternalStore(explainStore.subscribe, explainStore.getSnapshot, explainStore.getServerSnapshot);
  // Fail-safe: without an account the paste box cannot save (the sign-up
  // lives on step 1; this only matters when a session was lost on resume).
  const needsAccount = !draft.accountCreated;

  const refresh = () =>
    fetch("/api/sources")
      .then((r) => (r.ok ? (r.json() as Promise<{ sources?: SourceCard[] }>) : { sources: [] }))
      .then((j) => setCards(Array.isArray(j.sources) ? j.sources : []))
      .catch(() => {});

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void refresh();
  }, []);

  const dismissExplain = () => explainStore.set("hide");

  const add = async () => {
    if (busy || needsAccount || links.trim() === "") return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        added?: SourceCard[];
        rejected?: { link: string; reason: string }[];
      };
      if (!res.ok && !Array.isArray(j.added)) {
        setNotice("We could not save those links. They are still in the box, so try again.");
        return;
      }
      const added = j.added ?? [];
      setCards((c) => [...c, ...added]);
      setRejected(j.rejected ?? []);
      if (added.some((a) => a.kind === "social_profile" || a.kind === "single_post")) {
        explainStore.set("show"); // social source saved: the honest note again, if dismissed
      }
      setLinks("");
    } catch {
      setNotice("We could not reach the server. Your links are still in the box.");
    } finally {
      setBusy(false);
    }
  };

  const addWebsite = async (profileId: string) => {
    if (webBusy || webInput.trim() === "") return;
    setWebBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/sources/${profileId}/website`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: webInput.trim() }),
      });
      if (res.status === 422 || res.status === 404) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(typeof j.error === "string" && j.error !== "not_found" ? j.error : "We could not use that link. Paste the creator's own website address.");
        return;
      }
      if (!res.ok) {
        setNotice("We could not save that website. Try again.");
        return;
      }
      setWebFor(null);
      setWebInput("");
      await refresh(); // the profile card's chip changes once the website is linked
    } catch {
      setNotice("We could not reach the server. Try again.");
    } finally {
      setWebBusy(false);
    }
  };

  return (
    <section aria-label="Where your food comes from">
      <p className="ot-sub">
        Paste the blogs and creators you cook from — many links at once, separated by spaces or
        new lines. We tell you what we can do with each one.
      </p>

      {showExplain && (
        <OtCard tone="sky" heading="One honest note">
          <p className="ot-sources-explain">
            Instagram, TikTok, Facebook and Pinterest don&apos;t let apps read profiles. Save the
            creator, then share a post with us or add their website, and we&apos;ll pull in the
            recipes. Blogs and recipe sites import in full.
          </p>
          <OtButton kind="ghost" onClick={dismissExplain}>
            Got it
          </OtButton>
        </OtCard>
      )}

      <div className="ot-sources-paste">
        <label className="ot-field-label" htmlFor="sources-links">
          Your links
        </label>
        {needsAccount && (
          <p className="ot-meta">Sign in on the Welcome step first — then every link you paste is saved to your household.</p>
        )}
        <textarea
          id="sources-links"
          className="ot-input ot-sources-textarea"
          rows={3}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder={"https://blog.example.com/slow-pasta\nhttps://www.instagram.com/chef.example"}
          aria-describedby="sources-links-help"
          disabled={needsAccount}
        />
        <p id="sources-links-help" className="ot-meta">
          Each link is saved with its platform; nothing is read from social apps automatically.
        </p>
        <OtButton full onClick={add} disabled={busy || needsAccount || links.trim() === ""}>
          {busy ? "Adding…" : "Add links"}
        </OtButton>
      </div>

      {rejected.length > 0 && (
        <ul className="ot-sources-rejects" aria-label="Links that were not added">
          {rejected.map((r) => (
            <li key={r.link}>
              <strong>{r.link}</strong> — {r.reason}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="ot-meta">
          {notice}
        </p>
      )}

      <div className="ot-sources-list">
        {cards.map((c) => (
          <OtCard key={c.id}>
            <div className="ot-sources-card__head">
              <span className="ot-badge">{PLATFORM_LABEL[c.platform]}</span>
              <OtStatusChip kind={c.chip.kind}>{c.chip.text}</OtStatusChip>
            </div>
            <p className="ot-meta ot-sources-card__url">
              {c.creatorName ? `${c.creatorName} · ` : ""}
              {c.url}
            </p>
            {c.kind === "social_profile" && !c.websiteSourceId && (
              <div className="ot-sources-card__web">
                {webFor === c.id ? (
                  <div>
                    <label className="ot-field-label" htmlFor={`web-${c.id}`}>
                      The creator&apos;s website link
                    </label>
                    <input
                      id={`web-${c.id}`}
                      className="ot-input"
                      type="url"
                      inputMode="url"
                      value={webInput}
                      onChange={(e) => setWebInput(e.target.value)}
                      placeholder="https://chef.example.com"
                    />
                    <div className="ot-navrow">
                      <OtButton kind="ghost" onClick={() => setWebFor(null)}>
                        Cancel
                      </OtButton>
                      <OtButton kind="ghost" onClick={() => addWebsite(c.id)} disabled={webBusy || webInput.trim() === ""}>
                        {webBusy ? "Saving…" : "Save website"}
                      </OtButton>
                    </div>
                  </div>
                ) : (
                  <OtButton kind="ghost" onClick={() => { setWebFor(c.id); setWebInput(""); setNotice(null); }}>
                    Add their website ›
                  </OtButton>
                )}
              </div>
            )}
          </OtCard>
        ))}
        {cards.length === 0 && !busy && (
          <p className="ot-meta">Nothing saved yet — that is fine, we can start from our recipe starter library.</p>
        )}
      </div>

      <div className="ot-primary">
        <OtButton full onClick={() => goTo(6)}>
          {cards.length === 0 ? "Skip for now: use our starter recipes ›" : "Continue ›"}
        </OtButton>
        <div className="ot-navrow">
          <OtButton kind="ghost" onClick={goBack}>
            ‹ Back
          </OtButton>
        </div>
      </div>
    </section>
  );
}
