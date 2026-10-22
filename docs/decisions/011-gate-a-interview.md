# ADR 011 - Gate A interview finding (M2 entry)

Date: 2026-10-21 - Status: accepted (owner)

## Finding
The owner's interview finding: most saved recipes live on blogs or on the user's own social media profiles, i.e. recipes the user saved from those sources.

## Consequences
- The interview half of Gate A (PRD 14, M2) is satisfied, so M2 may proceed.
- Blog and social-profile sources are the priority for WP-2.1 to WP-2.5 (schema.org first, then the LLM fallback).
- The parse-accuracy half of Gate A (85% on core fields, WP-2.6 harness) is still open and must pass before M3.
- Social sources stay behind the terms review (WP-2.7, decisions note).
