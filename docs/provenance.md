# Source provenance

This public showcase has fresh Git history and no object relationship with the private `onlessV2` repository. Approved source material was selected from immutable committed blobs, then reduced to explicit public boundaries. Private dependency closures were not copied recursively; production dependencies were replaced with narrow public types/ports or omitted.

## Immutable source revisions

| Label | Full revision | Public use |
| --- | --- | --- |
| Primary product | `01f211acd56873e3c0f75a2f40e25871c298663c` | Web review/presentation patterns, API observability, Mobile offline algorithms, Desktop domain |
| Roadmap presentation | `50752b5cad43944c06ef536fcbe0a6c6a6026da4` | Roadmap visual/state and keyboard-navigation patterns only |
| Telegram Lite | `5ac47959faf415810cd32ac3393b63e587d96192` | Read-only dashboard, shell, copy, contract, and style selections |
| Exam UI evidence | `97547402063b6bf53c6d4ce8d5e43b62214c6848` | Active-exam and result screenshots only; no code extraction |

Every adapted row below passed the 2026-08-20 release-integrator scoped path/content review. Full-history secret, dependency, CodeQL, and container scans are repeated by the protected CI workflow after publication.

## Adapted code units

`normalized` means the algorithm or presentation pattern was retained while production imports, terminology, types, or composition were rebuilt for this public boundary. `new` means authored for this showcase rather than copied from a private file.

| Revision and private source | Exact selected material | Public destination | Transformation and material removals | Reviewer / scoped scan |
| --- | --- | --- | --- | --- |
| Primary · `frontend/lib/utils/exam-review-snapshot.ts` | review DTO/view-model declarations; `ReviewSnapshotValidationError`; header presentation; snapshot parsing/validation; `buildReviewPageViewModel` | `apps/web/src/review/types.ts`, `snapshot-validation.ts`, `snapshot-contract.ts`, `shared/uuid.ts` | normalized and split by responsibility; generated API types, battle fields, protected answer/content behavior, remote media, session/API composition removed | release integrator · PASS |
| Primary · `frontend/lib/utils/exam-answer-resolution.ts` | `resolveCorrectOptionId`, `resolveCorrectOptionIndex` | `apps/web/src/review/answer-resolution.ts` | normalized; incident narrative and production imports removed | release integrator · PASS |
| Primary · review-snapshot and answer-resolution unit suites | behavior cases for bounded snapshots, mapping, and answer resolution | `apps/web/test/review-snapshot-*.test.ts`, `answer-resolution.test.ts`, `review-fixtures.ts` | normalized with synthetic UUIDs/copy; production questions and response fixtures removed | release integrator · PASS |
| Primary · `frontend/app/(public-v2)/[locale]/_components/HomeHero.tsx` | `HomeHero` presentation pattern | `apps/web/src/showcase/app.tsx`, `showcase.css` | normalized into fixture-only Vite composition; Next routing, analytics, session CTA, remote fonts/assets removed | release integrator · PASS |
| Primary · `LearningRoute.tsx`, `HomeFaq.tsx`, `SignatureMethod.tsx` | `LearningRoute`, `FactsBand`, `HomeFaq`, `SignatureMethod` presentation patterns | `apps/web/src/showcase/app.tsx`, `content.ts`, `showcase.css` | normalized with PTA/local content; metrics, host policy, server content loading and external navigation removed | release integrator · PASS |
| Roadmap · `frontend/components/dashboard/student/v5/RoadmapProgress.tsx`, `RoadmapCapNode.tsx`, `RoadmapCheckpointNode.tsx`, `RoadmapTicketNode.tsx`, `RoadmapPathV5.tsx` | progress/node state visuals and keyboard-navigation patterns | `apps/web/src/roadmap/model.ts`, `roadmap-view.tsx`, `roadmap.css` | normalized to prop-driven semantic React; router, queries, VIP, mutations, ticket/checkpoint mapping, grand-mock start, animation dependency removed | release integrator · PASS |
| Primary · `backend/app/core/audit_redaction.py` | sensitivity constants/budgets; `is_sensitive_audit_key`, `redact_audit_text`, `sanitize_audit_data` behavior | `services/api/src/onless_api/observability/redaction.py` | normalized; auth/audit naming, service/database imports, user/order examples removed; bounded structural serialization retained | release integrator · PASS |
| Primary · `backend/app/core/request_correlation.py` | `get_trusted_request_id` behavior | `services/api/src/onless_api/observability/request_id.py` | normalized to server-owned IDs; caller ID trust/reflection removed | release integrator · PASS |
| Primary · `backend/app/middleware/request_id.py` | `get_request_id`, server-ID validation, generation/context lifecycle, middleware, logging filter | `services/api/src/onless_api/observability/request_id.py` | normalized; client host, headers, query/body/cookie/exception logging and production setup removed | release integrator · PASS |
| Primary · redaction and request-ID tests | bounded redaction and request-context behavior cases | `services/api/tests/test_observability_redaction.py`, `test_observability_request_id.py` | normalized with synthetic canaries; auth/session/database fixtures removed | release integrator · PASS |
| Primary · `mobile/src/features/exam-flow/offline/syncWorker.ts` | failure/result ports; safe reporter; full jitter; `ExamSyncWorker`; ordering logic | `apps/mobile/src/exam/offline/sync-worker.ts`, `processors.ts`, `backoff.ts` | normalized and split; auth taxonomy, API URLs, bearer flow, concrete repository/transport and protected response fields removed | release integrator · PASS |
| Primary · `offline/cleanup.ts` | terminal cleanup, sweep report, stale-preparation recovery | `apps/mobile/src/exam/offline/cleanup.ts` | normalized behind `MaintenanceStore`; filesystem/database implementation removed | release integrator · PASS |
| Primary · `offline/selfHeal.ts` | asset repair report and repair flow | `apps/mobile/src/exam/offline/self-heal.ts` | normalized behind `AssetStore`; asset-origin and Expo filesystem behavior removed | release integrator · PASS |
| Primary · `offline/packPreparer.ts` | concurrency bound, orchestration, integrity transitions, compensation | `apps/mobile/src/exam/offline/pack-preparer.ts` | normalized behind capability ports; concrete download/storage, protected manifest fields and production origins removed | release integrator · PASS |
| Primary · `offline/durableAnswerQueue.ts`; `coordinator/ownerSequencer.ts` | durable confirmation and owner-transition sequencing | `apps/mobile/src/exam/durable-answer-queue.ts`, `owner-sequencer.ts` | normalized; account/auth adapters and telemetry removed | release integrator · PASS |
| Primary · corresponding Mobile unit suites | ordering, retry, cancellation, cleanup, heal, pack, and owner-transition cases | `apps/mobile/test/*.test.ts`, `fixtures.ts` | normalized with typed synthetic builders and injected time/randomness | release integrator · PASS |
| Telegram Lite · `frontend/features/telegram-lite/dashboard.tsx` | loading/error blocks; resume refresh; stale suppression; `Stats`; read-only Home/Progress composition | `apps/telegram-lite/src/dashboard/*.tsx` | normalized and split; API/session providers, checkout/payment, profile mutation/linking, exam launch and external navigation removed | release integrator · PASS |
| Telegram Lite · `shell.tsx`, `icons.tsx` | `TelegramLiteShell`, tab semantics, three rendered icons | `apps/telegram-lite/src/shell/*.tsx` | normalized to three read-only local tabs; SDK/session/handoff behavior removed | release integrator · PASS |
| Telegram Lite · selected `copy.ts`, `contracts.ts` declarations | strings and summary/catalog/progress DTO fields rendered by the three tabs | `apps/telegram-lite/src/dashboard/copy.ts`, `domain/contracts.ts` | normalized; phone/OTP, auth, payment, profile mutation and backend contract breadth removed | release integrator · PASS |
| Telegram Lite · selected `telegram-lite.module.css`, `telegram-lite-root.css` rules | root/shell/nav/panel/stat/ticket/alert/spinner/score/accessibility reset selectors | `apps/telegram-lite/src/dashboard/dashboard.css` | normalized; unrelated flows and global product styles removed | release integrator · PASS |
| Primary · `desktop/packages/desktop-shared/src/types/exam.ts` | safe `Question`, `Answer`, `ExamSession`, `ExamMode`, `ExamResult` domain behavior | `apps/desktop-protocol/typescript/src/exam-domain.ts` | normalized; question/answer content, identifiers, persistence, network, device and protected fields removed | release integrator · PASS |
| Primary · `desktop/packages/desktop-shared/src/constants/exam-config.ts`, `mode-configs.ts` | safe numeric bounds; `ModeConfig`, `MODE_CONFIGS`, `getModeConfig` | `apps/desktop-protocol/typescript/src/mode-config.ts`, `rust/src/mode_config.rs` | normalized for cross-language parity; product-specific start policy removed | release integrator · PASS |
| Primary · `desktop/packages/desktop-shared/src/constants/i18n.ts`; `desktop/apps/client/src/lib/i18n/plural.ts` | `Locale`, translation behavior, used strings, `ruPlural` | `apps/desktop-protocol/typescript/src/i18n.ts`, `plural.ts`, `rust/src/i18n.rs` | normalized to `uz`/`ru` domain copy; unused application strings removed | release integrator · PASS |

## Newly authored public closure

| Public unit | Purpose | Private material deliberately not used | Reviewer / scoped scan |
| --- | --- | --- | --- |
| `apps/web/src/review/review-panel.tsx`, `review.css` | accessible synthetic review presentation | production result route, auth/VIP/payment, API client, question assets | release integrator · PASS |
| `apps/web/src/roadmap/projection.ts`, `apps/web/test/fixtures/api-roadmap-projection.json` | strict Web parser/view projection and API-shaped parity fixture | production roadmap service, thresholds, ticket maps, mutations | release integrator · PASS |
| `apps/web/src/showcase/*`, `main.tsx`, `index.html`, Vite configuration | runnable PTA/local product-story composition | production page/layout, SEO/analytics/consent/session composition | release integrator · PASS |
| `services/api/src/onless_api/learning/*` | pure identity-free roadmap projection, minimal evidence port, deterministic fixture, inputless route | production roadmap/mastery code, ORM/cache/settings/models/endpoints | release integrator · PASS |
| `services/api/src/onless_api/observability/events.py` | bounded diagnostic-event model over the redaction boundary | production logging composition and sinks | release integrator · PASS |
| `apps/mobile/src/exam/domain/*`, `ports.ts`, `offline/connectivity-probe.ts`, `src/index.ts` | narrow public contracts/decoders/capabilities and abortable probe | production wire contract, SQLite/Expo/network/credential/account adapters | release integrator · PASS |
| `apps/telegram-lite/src/demo/*`, Vite entry/configuration and dashboard tests | deterministic `Demo` adapter and independently runnable zero-network UI | Telegram SDK/initData, backend, handoff and account state | release integrator · PASS |
| `apps/desktop-protocol/rust/src/exam_domain.rs`, `lib.rs`; `fixtures/exam-modes.json`; parity tests | Rust implementation and shared synthetic parity boundary for the normalized public TS domain | private Rust/LAN protocol, discovery, heartbeat, addresses, privileged commands | release integrator · PASS |
| root documentation, CI, Dockerfiles, Compose, and Nginx configuration | public explanation, verification, scanning, and localhost-only runtime | private workflows, infrastructure, domains, credentials, topology | release integrator · PASS |

## Superseded baseline material removed in this expansion

- The earlier public stateful-lease example and local data-service demonstration topology were removed. The current API is a stateless synthetic learning/observability boundary.
- The earlier desktop discovery, heartbeat, connection-code, device-message, UUID-wire, and broad JSON fixtures were removed. The current desktop slice is only the safe exam/session domain and its Rust/TypeScript parity.
- The earlier Telegram profile-linking state machine was removed because profile linking belongs with private identity/bootstrap behavior. The current Telegram slice is read-only.

No private Git remote, alternate object directory, submodule, subtree, graft, bundle, worktree metadata, source archive, or private task/audit packet is included.

## Screenshot provenance

The six final WebPs are evidence artifacts, not extracted source modules. The active Web question and completed review at the Exam UI evidence revision, plus the native Mobile screen at the Primary product revision, use capture-only invented text fixtures through typed local boundaries; the fixtures and all raw captures/tooling were deleted after verification. None contains private/production question-bank question or answer text, explanations, signs, images, video, or other instructional media. Complete SHA-256 hashes, physical/CSS dimensions, source revision and route, runtime, network ledger, capture date, and independent verdict are recorded in [`screenshots/README.md`](screenshots/README.md).

## Third-party boundary

No third-party source tree, generated component library, font, binary, installer, or standalone asset was copied into this showcase. Package manifests and lockfiles declare ordinary build/test/runtime dependencies; their source is not vendored here. Onless publication authorization and contributor/rightsholder records are maintained outside this public repository.
