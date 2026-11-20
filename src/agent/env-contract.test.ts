/**
 * PRD §10.4 environment-variable contract for the agent layer.
 *
 * These tests exist because the provider/model plumbing had drifted onto
 * AGENT_LLM_PROVIDER / AGENT_LLM_MODEL / <NAME>_MODEL, none of which appear in
 * §10.4. The drift was invisible: nothing failed, the value set on Vercel was
 * simply never read, and every deploy silently used the built-in default.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentModel,
  DEFAULT_AGENT_MODEL,
  llmProvider,
  resolveProvider,
} from "./runtime";

const KEYS = [
  "LLM_PROVIDER",
  "AGENT_LLM_PROVIDER",
  "AGENT_MODEL_DEFAULT",
  "AGENT_MODEL_GUARDIAN",
  "GUARDIAN_MODEL",
  "SCOUT_MODEL",
] as const;

const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of KEYS) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    const v = snapshot.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("provider resolution (PRD §10.4 LLM_PROVIDER)", () => {
  it("prefers LLM_PROVIDER over the legacy name", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.AGENT_LLM_PROVIDER = "openai";
    expect(llmProvider()).toBe("anthropic");
  });

  it("still honours the legacy AGENT_LLM_PROVIDER when the PRD name is absent", () => {
    process.env.AGENT_LLM_PROVIDER = "openai";
    expect(llmProvider()).toBe("openai");
  });

  it("defaults to openrouter, per ADR-016", () => {
    expect(llmProvider()).toBe("openrouter");
  });

  it("rejects an unknown provider instead of passing it through", () => {
    // The old `as any` cast let a typo reach the HTTP layer as a bogus provider.
    expect(resolveProvider("oprnrouter")).toBe("openrouter");
  });
});

describe("model resolution (AGENT_MODEL_<NAME> -> AGENT_MODEL_DEFAULT -> ADR-016)", () => {
  it("per-agent AGENT_MODEL_<NAME> wins", () => {
    process.env.AGENT_MODEL_GUARDIAN = "anthropic/claude-opus-4-1";
    process.env.AGENT_MODEL_DEFAULT = "anthropic/claude-3.5-haiku";
    expect(agentModel("GUARDIAN")).toBe("anthropic/claude-opus-4-1");
  });

  it("falls back to AGENT_MODEL_DEFAULT", () => {
    process.env.AGENT_MODEL_DEFAULT = "anthropic/claude-3.5-haiku";
    expect(agentModel("GUARDIAN")).toBe("anthropic/claude-3.5-haiku");
  });

  it("falls back to the ADR-016 pinned model when nothing is configured", () => {
    expect(agentModel("GUARDIAN")).toBe(DEFAULT_AGENT_MODEL);
    expect(DEFAULT_AGENT_MODEL).toContain("claude-3.5-sonnet-20241022");
  });

  it("honours the legacy <NAME>_MODEL spelling", () => {
    process.env.SCOUT_MODEL = "anthropic/claude-3.5-haiku";
    expect(agentModel("SCOUT")).toBe("anthropic/claude-3.5-haiku");
  });

  it("keeps an explicit per-agent cost fallback below AGENT_MODEL_DEFAULT", () => {
    // A caller-supplied fallback (cheap agents) must not outrank the PRD vars.
    expect(agentModel("SCOUT", "anthropic/claude-3.5-haiku")).toBe("anthropic/claude-3.5-haiku");
    process.env.AGENT_MODEL_DEFAULT = "anthropic/claude-3.5-sonnet-20241022";
    expect(agentModel("SCOUT", "anthropic/claude-3.5-haiku")).toBe(
      "anthropic/claude-3.5-sonnet-20241022",
    );
  });
});
