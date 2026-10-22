/**
 * OpenRouter chat client for RE02. Never sends a `tools` field: the parser call is tool-less by design.
 */
import type { LlmClient } from "./llm-parser";

export function openRouterClient(opts: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): LlmClient {
  const f = opts.fetchImpl ?? fetch;
  const url = (opts.baseUrl ?? "https://openrouter.ai/api/v1") + "/chat/completions";
  return {
    async complete({ model, system, user }) {
      const res = await f(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`llm http ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("llm returned no text");
      return content;
    },
  };
}
