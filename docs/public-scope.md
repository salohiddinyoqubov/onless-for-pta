# Public showcase scope

## What this repository is

`onless-for-pta` contains curated, runnable slices selected to show engineering decisions behind the Onless learning journey. It is designed for President Tech Awards review and for local technical evaluation. The public tree has fresh Git history and no object relationship with the complete private `onlessV2` repository.

Included boundaries are:

- a runnable fixture-only Web learning journey and strict review/roadmap contracts;
- a stateless synthetic learning projection plus safe observability primitives;
- a mobile offline synchronization domain behind injected capabilities;
- a runnable read-only Telegram Lite dashboard backed by deterministic fixtures;
- a shared Rust/TypeScript desktop exam/session domain with parity tests;
- localhost-only containers, behavioral tests, CI security checks, documentation, and six independently reviewed product UI screenshots.

These slices are intentionally self-contained. Shared product concepts do not imply a live integration: the Web and Telegram demos make no external request, the API accepts no identity, Mobile and Desktop are domain libraries, and the Compose services do not share a network.

## What is not published

The repository contains none of the following:

- the production frontend, backend, mobile, desktop, Telegram Lite, or Telegram bot composition roots;
- authentication, password/OTP/OAuth, token/session rotation, RBAC/admin, impersonation, profile linking, or Telegram `initData` verification;
- payments, IAP, checkout, receipts, refunds, certificates, cashback, or private product/business metrics;
- anti-cheat, answer obfuscation/encryption, shuffle seeds, secure answer tokens, battles/WebSockets, watermark/font pools, or content-protection internals;
- question selection, ticket mappings, pass thresholds, question/answer banks, explanations, lesson/RAG corpora, road-sign media, generated audio/video, or user uploads;
- production roadmap/mastery services, ORM models, migrations, databases, caches, customer repositories, or production configuration/topology;
- mobile SQLite/Expo filesystem/network/credential adapters, API URLs, bearer behavior, or correct-answer response schemas;
- desktop LAN discovery/server/client runtime, device addresses/identifiers, licensing, persistence, kiosk/power commands, or unfinished Tauri/Svelte routes;
- customer, school, account, analytics, log, payment, or operational data; production credentials; private Git objects or history.

## Data and screenshot policy

Runnable code uses only deterministic synthetic fixtures named `Demo`, local values, and synthetic UUIDs. The API route is inputless. The Web and Telegram builds contain no analytics, storage, remote font, or network client.

The six WebP files under `docs/screenshots` show real complete-product interfaces, not the public demo. Each was rendered at a pinned source revision through local synthetic boundary data. The active Web question, completed Web review, and native Mobile exercise use explicitly invented text-only capture fixtures; none includes private/production question-bank question or answer text, explanations, signs, images, video, or other instructional media. No production account/data request, image generation, compositing, retouching, screenshot-time hiding, raw capture, trace, or capture credential is included. Exact provenance and independent verdicts are recorded in [screenshots/README.md](screenshots/README.md).

## Reviewable size

Using physical lines and counting `.ts`, `.tsx`, `.py`, `.rs`, and component-owned `.css` in product source directories, the current public review surface has:

| Measure | Value |
| --- | ---: |
| Implementation files / LOC | 60 / 9,238 |
| Test files / LOC | 32 / 7,846 |
| Test LOC as a share of implementation LOC | 84.9% |

Lockfiles, generated output, JSON fixtures, HTML, documentation, CI, and Docker/configuration are excluded from the LOC figures. No implementation file exceeds 500 LOC. File count is not treated as a quality claim; the independent suites exercise validation, failure, ordering, cancellation, concurrency, accessibility, and cross-language parity invariants.

## License and access

This repository is source-available proprietary software, not open source. The [Onless PTA Showcase License](../LICENSE) permits limited evaluation and reserves all other rights. Public hosting does not grant access to production services, data, or the private repository.

Authorized PTA reviewers can request access to the complete private `onlessV2` repository using the bilingual process in the root [README](../README.md). Publication authorization, contributor rights, and PTA eligibility are organizational records maintained outside this public repository.
