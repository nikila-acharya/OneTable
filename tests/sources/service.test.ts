/**
 * WP-2.7 sources service (live DB): paste -> rows with chips, "add their
 * website" (CP04), household scope, and the CP04 AC that saving social links
 * performs no network I/O at all.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { household } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { saveParsedRecipe } from "../../src/lib/recipes/review";
import { addLinks, linkWebsite, listSources } from "../../src/lib/sources/service";

const hasDb = Boolean(process.env.DATABASE_URL);
const created: string[] = [];
const FIELDS = {
  title: "Bean Soup",
  ingredients: ["1 cup beans", "1 onion"],
  steps: ["Simmer."],
  yieldText: null,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: 40,
  category: [],
  cuisine: ["Mexican"],
  author: null,
};

describe.skipIf(!hasDb)("WP-2.7 sources service (live DB)", () => {
  let db: Db;

  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });

  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold(tag: string): Promise<string> {
    const [hh] = await db
      .insert(household)
      .values({ name: `wp27-${tag}-${randomBytes(4).toString("hex")}`, tier: "free", timezone: "UTC" })
      .returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("paste of mixed links: one row per link, plain-words rejects, NO fetch happens", async () => {
    const hh = await newHousehold("paste");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const out = await addLinks(db, hh, [
        "https://blog.example.test/recipes/",
        "https://www.instagram.com/chef.nina/",
        "https://www.tiktok.com/@chef.nina",
        "https://www.youtube.com/@chefnina",
        "hello",
        "http://127.0.0.1/private",
      ].join("\n"));

      expect(out.added).toHaveLength(4);
      expect(out.websiteUrls).toEqual(["https://blog.example.test/recipes/"]);
      const kinds = Object.fromEntries(out.added.map((c) => [c.platform, c.kind]));
      expect(kinds).toEqual({ website: "website", instagram: "social_profile", tiktok: "social_profile", youtube: "youtube_channel" });

      // CP04 AC: saving made zero network requests of any kind.
      expect(fetchSpy).not.toHaveBeenCalled();

      // chips (§16.5)
      const ig = out.added.find((c) => c.platform === "instagram")!;
      expect(ig.needsWebsite).toBe(true);
      expect(ig.chip.text).toBe("Linked — share posts to add recipes");
      const yt = out.added.find((c) => c.platform === "youtube")!;
      expect(yt.chip.text).toBe("Linked"); // reader flag OFF (ADR-015)
      expect(yt.needsWebsite).toBe(false);
      const web = out.added.find((c) => c.kind === "website")!;
      expect(web.chip.text).toBe("Importing recipes…");

      // plain-words rejections
      expect(out.rejected).toHaveLength(2);
      expect(out.rejected[0]!.reason).toBe("That does not look like a web link.");
      expect(out.rejected[1]!.reason).toContain("private network");

      // creator labels
      expect(ig.creatorName).toBe("chef.nina");
      expect(yt.creatorName).toBe("chefnina");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("duplicate links are refused in plain words", async () => {
    const hh = await newHousehold("dup");
    const first = await addLinks(db, hh, "https://blog.example.test/recipes/");
    expect(first.added).toHaveLength(1);
    const again = await addLinks(db, hh, "https://blog.example.test/recipes/");
    expect(again.added).toHaveLength(0);
    expect(again.rejected[0]!.reason).toBe("You already saved that link.");
  });

  it("add-website links a creator card; a social link is refused for it", async () => {
    const hh = await newHousehold("web");
    const { added } = await addLinks(db, hh, "https://www.pinterest.com/chefnina/");
    const pin = added[0]!;
    expect(pin.needsWebsite).toBe(true);

    const bad = await linkWebsite(db, hh, pin.id, "https://www.instagram.com/other.chef/");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("own website");

    const ok = await linkWebsite(db, hh, pin.id, "https://chefnina.example.test/");
    expect(ok.ok).toBe(true);

    const cards = await listSources(db, hh);
    const pinCard = cards.find((c) => c.id === pin.id)!;
    expect(pinCard.websiteSourceId).toBeTruthy();
    expect(pinCard.needsWebsite).toBe(false);
    expect(pinCard.chip.text).toBe("Importing recipes…"); // linked site, no recipes yet
  });

  it("website chips count recipes; household scope holds", async () => {
    const mine = await newHousehold("scope-mine");
    const other = await newHousehold("scope-other");

    await addLinks(db, mine, "https://blog.example.test");
    await saveParsedRecipe(db, mine, {
      fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/soup", parseMethod: "markup",
    });
    await saveParsedRecipe(db, mine, {
      fields: { ...FIELDS, title: "Chili" }, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/chili", parseMethod: "markup",
    });

    const cards = await listSources(db, mine);
    expect(cards[0]!.chip).toEqual({ kind: "ok", text: "2 recipes added" });

    const foreign = await listSources(db, other);
    expect(foreign).toHaveLength(0);
  });

  it("youtube reader flag is fail-safe: only the exact value 'on' enables it", async () => {
    const { isYoutubeReaderEnabled } = await import("../../src/lib/sources/youtube");
    expect(isYoutubeReaderEnabled({})).toBe(false);
    expect(isYoutubeReaderEnabled({ YOUTUBE_READER_ENABLED: "true" })).toBe(false);
    expect(isYoutubeReaderEnabled({ YOUTUBE_READER_ENABLED: "1" })).toBe(false);
    expect(isYoutubeReaderEnabled({ YOUTUBE_READER_ENABLED: "on" })).toBe(true);
  });
});
