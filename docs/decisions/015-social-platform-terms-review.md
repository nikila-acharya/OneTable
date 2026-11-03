# ADR 015 - WP-2.7 social platform terms review (CP04)

Date: 2026-10-26 - Status: proposed (owner must approve before the YouTube reader flag is turned on)

Review by: Hermes (engineering review, primary sources only - not legal advice).
Sources were re-fetched 2026-10-26; each platform rewrites its terms periodically, so
this note carries a re-check trigger: any change to `POLICY` in `src/lib/sources/platform.ts`
or turning the YouTube flag requires re-reading the linked documents.

## Question

PRD 5.3 CP04 lets a User save trusted creators from Instagram, TikTok, YouTube,
Pinterest and Facebook. Before the app touches any of those domains, what do the
platforms' own terms allow?

Three flows were checked:

- **A. profile read** - automated reading of a public profile page (crawler).
- **B. post read** - fetching the HTML of one public post the User shared (no login).
- **C. oEmbed** - the platform's official embed endpoint for a single public post
  (PRD CP02 proposed using it to read titles/captions).

## Findings (quoted from the terms themselves)

### Instagram - Meta

- Terms of Use 4.2: "You can't attempt to create accounts or access or collect
  information in unauthorized ways. This includes ... accessing or collecting
  information in an automated way without our express permission, regardless of
  whether such automated access or collection is undertaken while logged-in."
  https://help.instagram.com/581066165581870
- oEmbed endpoint: requires Meta App Review for the "oEmbed Read" feature and an
  App or Client Access Token; and "Using metadata and page, post, or video
  content (or their derivations) from the endpoint for any purpose other than
  providing a front-end view ... is strictly prohibited. This prohibition
  encompasses consuming, manipulating, extracting, or persisting" it.
  https://developers.facebook.com/docs/instagram/oembed
- **Update 2026-10-26 re-check:** Meta lifted the token requirement for all
  oEmbed APIs (Instagram, Facebook, Threads) on **2026-06-15**: no App Review,
  1,000 requests/h/endpoint
  ([Graph API reference v26.0](https://developers.facebook.com/docs/graph-api/reference/oembed-post/)).
  The change removes access friction; it does not license uses beyond
  embedding ("App Review will no longer be required to **embed** public Meta
  content"). The extract/persist prohibition above stays in the docs, so the
  ruling below is unchanged — the endpoint may decorate a source card, and
  caption text never becomes a stored recipe.
- **Verdict: A no. B no. C display-only — embed title/author for the card via
  the tokenless endpoint; extracting recipe text from it stays prohibited.**

### Facebook - Meta

- Meta Terms of Service 3.2(3): "You may not access or collect data from our
  Products using automated means (without our prior permission) ... regardless of
  whether such automated access or collection is undertaken while logged-in."
  https://www.facebook.com/legal/terms (plain text: https://mbasic.facebook.com/legal/terms/plain_text_terms/)
- Meta Platform Terms: data may only be processed through the approved Platform
  APIs, with App Review; prohibited practices include processing beyond permitted
  purposes. https://developers.facebook.com/terms/
- Public Graph API reads of profiles/posts require an access token; there is no
  unauthenticated public oEmbed endpoint.
- **Update 2026-10-26 re-check:** same Meta-wide change as Instagram — Facebook
  oEmbed Post/Video are tokenless since 2026-06-15, still embedding-only.
- **Verdict: A no. B no. C display-only for a user-shared public post (card
  title/attribution); token reads of profiles and the Platform Terms' App
  Review path stay out of scope for a private household app.**

### TikTok

- Terms of Service 4.5 (EEA, last updated July 2026): you must not use the
  Platform to "extract any data or content from the Platform using any automated
  system or software that is not provided by TikTok or approved in writing by
  TikTok". The official oEmbed below is "provided by TikTok", so its use is the
  sanctioned exception; the terms apply logged-out as well (4.2).
  https://www.tiktok.com/legal/page/eea/terms-of-service/en
- TikTok's own developer docs offer a public oEmbed (GET https://www.tiktok.com/oembed?url=...)
  for embedding a single video; it returns embed HTML, title, author and
  thumbnail - not the caption body.
  https://developers.tiktok.com/doc/embed-videos
- **Verdict: A no. B no. C only as designed: the public oEmbed may be used to
  show the post's title/attribution for a User-shared video, not to extract a
  recipe. Recipe content from a TikTok post stays on the manual-entry path
  (CP02: "open a manual-entry form prefilled with whatever was parsed").**

### Pinterest

- Terms of Service 2a: "you agree not to scrape, collect, search, copy or
  otherwise access data or content from Pinterest in unauthorized ways, such as
  by using automated means (without our express prior permission)."
  https://policy.pinterest.com/en/terms-of-service
- The old public oEmbed/widget endpoints were retired; the current API
  (developers.pinterest.com) requires app approval and OAuth.
- **Verdict: A no. B no. C no (no unauthenticated endpoint any more). A pin
  usually links out to the creator's own website, so the "Add their website"
  flow is the designed path (CP04).**

### YouTube

- YouTube Terms of Service (2023-12-15): "you may not ... access the Service
  using any automated means (such as robots, botnets or scrapers) except (a) in
  the case of public search engines, in accordance with YouTube's robots.txt
  file; or (b) with YouTube's prior written permission."
  https://www.youtube.com/t/terms
  -> HTML scraping of channel pages: no.
- YouTube API Services Terms of Service 3.1: access to YouTube data is granted
  through the API Services "by the means described in the Agreement ... in
  accordance with the documentation". Reading a public channel's video list and
  video titles/descriptions through the official Data API is the sanctioned path.
  https://developers.google.com/youtube/terms/api-services-terms-of-service
  Obligations that come with it: a published privacy policy describing what the
  app accesses (7), security measures (8), attribution/branding rules (10), and
  no misleading modification of API data. Retention rules bind user data; the
  channel reader touches only creator-published public metadata (video IDs,
  titles, descriptions) and keeps them as private household copies under the
  same PV01 consent gates as blog imports.
- A public oEmbed (https://www.youtube.com/oembed) exists without a key but
  returns only title/author/embed HTML - fine for the "View the original" card,
  not for descriptions.
- **Risk found 2026-10-26 (Developer Policies, re-read):** Non-Authorized Data
  (API-key reads the channel owner never authorized — our case) may be stored
  "not longer than 30 calendar days"; then it "must either delete or refresh"
  ([III.E.4.d](https://developers.google.com/youtube/terms/developer-policies)),
  and API data must not be turned into "new or derived data or metrics"
  (III.E.8). A permanent private recipe parsed from a description is exactly
  what these rules make conditional. Default quota 10,000 units/day,
  search.list 100/day.
- **Verdict: A yes-via-API-only in principle, but the flag stays OFF even
  after note approval until the reader ships a <30-day refresh/re-validation
  loop for description-derived copies (owner decision, PRD 13.3). B not needed.
  C limited display only.**

## Product rules adopted (enforced in code)

1. The app NEVER fetches instagram.com, facebook.com, tiktok.com, pinterest.com,
   pin.it or youtube.com HTML. One choke point: `src/lib/sources/guard.ts`
   `assertFetchable`, called by the single-link import path and the background
   crawler queue; tests with a mocked fetcher assert zero calls (PRD CP04 AC).
2. Pasting a social profile link creates a `source` row with
   `kind = social_profile` and the "add their website" prompt - no network
   request (CP04 AC, first sentence of the plain-words explanation matches the
   PRD copy).
3. TikTok: the only automated read allowed is the official public oEmbed for a
   User-shared video - title + attribution for the card, never recipe text
   (same display-only rule as Meta and YouTube since 2026-06-15; Pinterest:
   call nothing, its oEmbed is not sanctioned). Recipe content from a shared
   TikTok/IG/FB post goes through the manual entry form (CP02 prefill
   behaviour unchanged: nothing parsed = empty form).
4. YouTube channel reader: implemented behind the flag
   `YOUTUBE_READER_ENABLED` (default **off**). Turning it on requires, per
   PRD 13.3: owner approval of this note, a Google Cloud project + API key
   (external account creation + quota management, 10,000 units/day free).
   Until then the source card shows "Linked", never "Reading public videos".
5. Blog links found inside YouTube descriptions (once the reader is on) are
   presented for confirmation and then imported as ordinary CP01 sources - the
   fetch target is the blog, not YouTube.

## WP-2.6 consequence (blog vs social share)

The harness's 10 social posts are Instagram reels. Under rule 1 above they are
not machine-readable by design; 0/10 could be imported automatically, and none
was fetched (the guard). The parse-accuracy measure stays the owner-approved
39/40-URL blog-page figure (ADR-011, PASS at 89.7%). The report records this
as the blog-vs-social split: **social is a save-and-route flow, not a parse
flow** - which is what CP04's table describes.

## Open items for the owner (PRD 13.3)

- Approve or amend this note.
- Decide whether to turn the YouTube reader flag on (needs a Google Cloud API
  key; free quota is enough for the beta scale).
