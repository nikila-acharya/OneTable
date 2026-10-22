# ADR 012 - LLM fallback parser (RE02, WP-2.3)

Date: 2026-10-22 - Status: accepted for the parser; the review screen is not built yet
Relates to: PRD 5.3 (RE02, copyright rules), 7.4 (untrusted content, prompt injection), ADR-010 (cost plan)

## Decisions
1. **Tool-less call.** The parser sends no tools field (tested at the client). It returns the RE01 schema plus a confidence per field.
2. **Verbatim method steps.** Each step must appear on the page (after whitespace normalisation). The parser splits text; it does not rewrite. A step that is not on the page makes the output invalid. Ingredient lines or a title that are not on the page lower their confidence instead.
3. **Retry once, then manual entry.** The retry tells the model what was refused. A second refusal ends in plain words: "We could not read this page's recipe reliably, so please enter it by hand."
4. **Unsure fields.** Any field with confidence below 0.8 [Proposed] is listed as unsure for the User to confirm.
5. **Untrusted page text.** It is cleaned, capped at 20,000 characters and sent between markers, with a system rule that it is data. Injection tests use a mock model: the output stays within the recipe fields.

## Model choice (live check, 2026-10-22, one page with its markup removed)
- openai/gpt-4o-mini: refused twice (a method step was reworded). Not used.
- openai/gpt-4o: passed in about 6 s, 5 ingredients and 4 steps, steps verbatim. **Default** (DEFAULT_PARSER_MODEL), overridable with PARSER_MODEL.
- anthropic/claude-3.5-haiku: the service refused the request from here. Not tested further.

## Not done yet
- **Review screen for unsure fields** (RE02 "user review"). The parser returns the unsure list; the screen comes next.
- **Injection eval on live models.** The current injection tests use a mock model. A live run on a crafted page is still to do.
- **Cost:** a few cents per check with gpt-4o; the live checks used the owner's OpenRouter credit.
