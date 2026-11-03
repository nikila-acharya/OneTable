---
id: ADR-016
title: M4 agent LLM provider and model
date: 2026-11-03
status: APPROVED
owner: Nikila Acharya
---

# ADR-016: M4 Agent LLM Provider and Model

## Decision
**OpenRouter + Claude 3.5 Sonnet**

- Provider: OpenRouter (multi-model abstraction, pay-as-you-go, fallback support)
- Model: Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
- Cost estimate: $0.003–0.015 per request; ~$0.05–0.10 per household per week (1–2 plan drafts + scout + check-in)

## Rationale
1. **Reasoning capability**: Sonnet handles multi-step reasoning (preference translation, memory learning, route disambiguation) better than GPT-4o at equivalent cost
2. **Stability**: Sonnet is mature (Oct 2024 release); less likely to degrade mid-run
3. **Safety**: Strong instruction-following for Guardian prompt (SG04 eating-disorder detection); lower jailbreak risk than open models
4. **Cost posture**: $0.10/household/week fits the "free tier" philosophy through M6; Qwen would be $0.02–0.05/week but weaker reasoning
5. **OpenRouter benefits**: multi-provider fallback if Anthropic API is down; rate-limit pooling across all users

## Consequences
- Guardian eval set for M4.2 must include Sonnet's actual output (not mocked)
- Weekly cycle cost for 100 households ≈ $10/week ($520/year), scale-neutral until launch
- Provider lock-in risk: if Sonnet degrades, switch to GPT-4o with 1-day re-eval

## Alternatives Considered
- **GPT-4o**: $0.015–0.030 per request; 2–3x cost, similar reasoning
- **Qwen 2.5**: $0.0001–0.0005 per request; ~40x cheaper, but weaker at instruction-following and eating-disorder detection; rejected for Guardian safety
- **Llama via Together**: open-source, low cost, but no commercial SLA and weaker reasoning
