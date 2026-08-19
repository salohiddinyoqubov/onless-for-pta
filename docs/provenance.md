# Source provenance

This repository is a curated public showcase built from independently reviewed file contents. It has fresh Git history and no object relationship with the private `onlessV2` repository.

Only the paths below were approved as extraction sources. Content was read from the pinned commit objects, never from a worktree. Each selected module was normalized into a small, self-contained public boundary; unlisted dependencies were represented by narrowly scoped local types or interfaces rather than copied implicitly.

## Primary source revision

Pinned private source commit: `01f211acd56873e3c0f75a2f40e25871c298663c`

| Public module | Reviewed source path | Public destination |
| --- | --- | --- |
| Web | `frontend/lib/utils/exam-launch.ts` | `apps/web/src/exam/launch-contract.ts` |
| Web | `frontend/lib/utils/exam-route-identity.ts` | `apps/web/src/exam/route-identity.ts` |
| Web | `frontend/__tests__/unit/lib/exam-launch.test.ts` | `apps/web/test/exam-launch.test.ts` |
| Web | `frontend/__tests__/unit/lib/exam-route-identity.test.ts` | `apps/web/test/exam-route-identity.test.ts` |
| API | `backend/app/core/content_access_tracker.py` | `services/api/src/onless_api/focus_lease.py` |
| API | `backend/tests/unit/core/test_content_access_tracker.py` | `services/api/tests/test_focus_lease.py` |
| Mobile | `mobile/src/features/exam-flow/coordinator/ownerSequencer.ts` | `apps/mobile/src/exam/owner-sequencer.ts` |
| Mobile | `mobile/src/features/exam-flow/coordinator/__tests__/ownerSequencer.test.ts` | `apps/mobile/test/owner-sequencer.test.ts` |
| Mobile | `mobile/src/features/exam-flow/offline/durableAnswerQueue.ts` | `apps/mobile/src/exam/durable-answer-queue.ts` |
| Mobile | `mobile/src/features/exam-flow/offline/__tests__/durableAnswerQueue.test.ts` | `apps/mobile/test/durable-answer-queue.test.ts` |
| Desktop protocol | `desktop/crates/protocol/Cargo.toml` | `apps/desktop-protocol/rust/Cargo.toml` |
| Desktop protocol | `desktop/crates/protocol/src/lib.rs` | `apps/desktop-protocol/rust/src/lib.rs` |
| Desktop protocol | `desktop/crates/protocol/src/messages.rs` | `apps/desktop-protocol/rust/src/messages.rs` |
| Desktop protocol | `desktop/crates/protocol/src/connection_code.rs` | `apps/desktop-protocol/rust/src/connection_code.rs` |
| Desktop protocol | `desktop/crates/protocol/src/heartbeat.rs` | `apps/desktop-protocol/rust/src/heartbeat.rs` |
| Desktop protocol | `desktop/crates/protocol/src/discovery.rs` | `apps/desktop-protocol/rust/src/discovery.rs` |
| Desktop protocol | `desktop/packages/desktop-shared/src/types/protocol.ts` | `apps/desktop-protocol/typescript/src/protocol.ts` |

## Telegram Lite source revision

Pinned private source commit: `0175f7990024d5895e16f3aa76bf0d02674ba877`

| Public module | Reviewed source path | Public destination |
| --- | --- | --- |
| Telegram Lite | `frontend/features/telegram-lite/state-machine.ts` | `apps/telegram-lite/src/linking-state-machine.ts` |
| Telegram Lite | Required types from `frontend/features/telegram-lite/contracts.ts` | Narrow local types in `apps/telegram-lite/src/linking-state-machine.ts` |
| Telegram Lite | `frontend/__tests__/unit/telegram-lite/state-machine.test.ts` | `apps/telegram-lite/test/linking-state-machine.test.ts` |

## Newly authored showcase files

The public documentation, license, CI workflow, static landing page, container definitions, and FastAPI HTTP boundary were authored specifically for this repository. They are not copies of private application files. The HTTP boundary wraps the normalized focus-lease module through its public interface; PostgreSQL is a local topology placeholder and does not hold product data.

- `README.md`, `LICENSE`, `SECURITY.md`, and `docs/architecture.md`
- `.github/workflows/ci.yml` and `.dockerignore`
- `deploy/compose.yml`, `deploy/.env.example`, the container Dockerfiles, `deploy/nginx.conf`, and `deploy/site/*`
- `services/api/src/onless_api/app.py` and `services/api/tests/test_app.py`

## Validation record

On 2026-08-19, every source path listed above was confirmed to exist and be readable at its pinned commit before extraction. Review then confirmed that the public destinations contain no private Git history, source datasets, media, production configuration, payment implementation, generated dependency state, or broad application directories. The repository ignore policy and CI scanners provide additional publication safeguards.
