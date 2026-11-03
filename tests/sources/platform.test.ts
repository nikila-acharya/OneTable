/** WP-2.7 CP04: platform detection matrix (pure; PRD 5.3 CP04 table). */
import { describe, expect, it } from "vitest";
import { POLICY, classifyLink, isNeverFetchedHost, splitLinks } from "../../src/lib/sources/platform";

describe("CP04 platform detection", () => {
  it("Instagram: profile vs reel/post", () => {
    const profile = classifyLink("https://www.instagram.com/chef.nina/");
    expect(profile).toMatchObject({ platform: "instagram", kind: "social_profile", mayFetch: false, needsWebsite: true });
    expect(profile.note.startsWith("Instagram doesn't let apps read profiles")).toBe(true);
    const reel = classifyLink("https://www.instagram.com/reel/DdZ02t-TBa6/");
    expect(reel).toMatchObject({ platform: "instagram", kind: "single_post", mayFetch: false });
    const post = classifyLink("https://instagram.com/p/AbC123/");
    expect(post.kind).toBe("single_post");
  });

  it("TikTok: profile vs video, and share links", () => {
    expect(classifyLink("https://www.tiktok.com/@chef.nina")).toMatchObject({ platform: "tiktok", kind: "social_profile", mayFetch: false });
    expect(classifyLink("https://www.tiktok.com/@chef.nina/video/7412345678901234567")).toMatchObject({ kind: "single_post" });
    expect(classifyLink("https://vm.tiktok.com/ZMRabc123/")).toMatchObject({ platform: "tiktok", kind: "single_post", mayFetch: false });
  });

  it("YouTube: channel vs video, youtu.be", () => {
    expect(classifyLink("https://www.youtube.com/@chefnina")).toMatchObject({ platform: "youtube", kind: "youtube_channel", mayFetch: false });
    expect(classifyLink("https://www.youtube.com/channel/UC012abc")).toMatchObject({ kind: "youtube_channel" });
    expect(classifyLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({ kind: "single_post", mayFetch: false });
    expect(classifyLink("https://www.youtube.com/shorts/abc123")).toMatchObject({ kind: "single_post" });
    expect(classifyLink("https://youtu.be/abc123")).toMatchObject({ platform: "youtube", kind: "single_post" });
  });

  it("Pinterest: profile vs pin vs shortened pin", () => {
    expect(classifyLink("https://www.pinterest.com/chefnina/")).toMatchObject({ platform: "pinterest", kind: "social_profile", needsWebsite: true });
    expect(classifyLink("https://www.pinterest.com/pin/1234567890/")).toMatchObject({ kind: "single_post" });
    expect(classifyLink("https://pin.it/5AbCdEf")).toMatchObject({ kind: "single_post", mayFetch: false });
  });

  it("Facebook: profile vs post", () => {
    expect(classifyLink("https://www.facebook.com/chefnina")).toMatchObject({ platform: "facebook", kind: "social_profile", mayFetch: false });
    expect(classifyLink("https://www.facebook.com/chefnina/posts/10100000000000000")).toMatchObject({ kind: "single_post" });
  });

  it("blogs and recipe sites are ordinary websites", () => {
    expect(classifyLink("https://blog.example.test/2026/10/slow-pasta")).toMatchObject({ platform: "website", kind: "website", mayFetch: true });
    expect(classifyLink("https://recipes.example.com/")).toMatchObject({ kind: "website", mayFetch: true });
  });

  it("never-fetched hosts cover apex, www and subdomains", () => {
    for (const host of ["instagram.com", "www.instagram.com", "tiktok.com", "vm.tiktok.com", "pinterest.com", "worldwide.pinterest.com", "pin.it", "facebook.com", "m.facebook.com", "youtube.com", "youtu.be", "music.youtube.com"]) {
      expect(isNeverFetchedHost(host), host).toBe(true);
    }
    for (const host of ["blog.example.test", "www.example.com", "fakeinstagram.com", "instagram.com.evil.test"]) {
      expect(isNeverFetchedHost(host), host).toBe(false);
    }
  });

  it("ADR-015 policy: no social HTML fetch; official oEmbed only where sanctioned, display-only", () => {
    expect(POLICY.website.oembed).toBe("none");
    expect(POLICY.instagram.oembed).toBe("display");
    expect(POLICY.facebook.oembed).toBe("display");
    expect(POLICY.tiktok.oembed).toBe("display");
    expect(POLICY.youtube.oembed).toBe("display");
    expect(POLICY.pinterest.oembed).toBe("none"); // exists but unsanctioned (ADR-015)
    for (const p of ["instagram", "facebook", "tiktok", "pinterest", "youtube"] as const) {
      expect(POLICY[p].mayFetch, p).toBe(false);
    }
  });

  it("splitLinks handles newlines, spaces and trailing punctuation", () => {
    expect(splitLinks("a.com/x\n b.com/y ,,c.com/z; d.com/w ;")).toEqual([
      "a.com/x",
      "b.com/y",
      "c.com/z",
      "d.com/w",
    ]);
    expect(splitLinks("   ")).toEqual([]);
  });
});
