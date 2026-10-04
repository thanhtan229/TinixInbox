# Final Production Review

## Confirmed Meta account and callback verification — 03/10/2026, 19:00 UTC+7

The operator confirmed the Page connection. The backend restart initially revoked it because the latest `.env` no longer contained Meta settings. Recovered the exact App ID, rotated App Secret and Verify Token from the encrypted saved connection; the associated Page Token passed Meta `debug_token` as a valid PAGE token for that app with `pages_messaging` and `pages_manage_metadata`. Restored those values and the Chatwoot callback URL to the ignored local `.env`, after verifying Chatwoot API Inbox 5. Reconnected the existing record without creating another binding; it is **connected** on Inbox 5. Restarted backend PID 93592 → **79168** after config recovery; health returns `ok` and startup did not revoke the connection. Relay PID **110424** answers the local valid verification challenge with HTTP 200. No secret values were emitted.

**LIVE INBOUND BLOCKER:** Meta's app-level Page webhook subscription is active for `messages` and `messaging_postbacks`, but its configured callback host is `stream-eddie-scuba-imperial.trycloudflare.com`; DNS returns `ENOTFOUND`. The external callback challenge could not reach the relay. The currently running cloudflared process is remotely managed and supplies no local ingress hostname/config evidence. A stable, resolving HTTPS ingress to the Meta relay on loopback port 3184 must be configured, then Meta's callback URL updated and externally rechecked. Do not treat the green connected state as proof that live messages are arriving.

No real outbound message was sent: there is no designated test recipient/PSID, and sending to a live customer would be an external side effect. After the callback is repaired, verify inbound with a user-controlled test account, then send a reply only in that same confirmed test conversation. Existing 119-test build and synthetic/live Chatwoot checks remain unchanged; this follow-up made local configuration and report changes, not source-code changes.

## Meta configuration refresh — 03/10/2026, 18:27 UTC+7

The operator has now populated the local `.env` Meta App ID, App Secret, Verify Token, `META_SECRET_ROTATED=true`, and Chatwoot callback URL. Values were checked only for presence and not printed. Backend PID 117580 was confirmed by its Tinix command line and replaced with PID 116520; new `/health` returns `ok`, and the local Meta inspect endpoint has passed the configuration gate (an empty-token request now returns the expected “token required” validation). The encrypted Page credential still in the database is expired (OAuth code 190/subcode 463); it has not been refreshed. Real connection acceptance remains pending entry and confirmation of a new Page Access Token in the app.

## Stored Meta account live verification — 03/10/2026, 16:03 UTC+7

**STATUS: BLOCKED_BY_PROVIDER — stored Page Token expired.** Used the existing encrypted credentials for connection `conn-8386382e`, Page “Tinix” (`1106784475845782`), without printing secrets or changing the connection state. Live Graph API `GET /me?fields=id,name` and `GET /1106784475845782/subscribed_apps` both returned **HTTP 401 / OAuthException code 190, subcode 463**. Meta's response explicitly says the session expired on **02-Oct-2026 08:00 PDT** (02-Oct-2026 22:00 UTC+7). The saved account exists but cannot currently authenticate.

No send or subscription mutation was attempted with the expired token. Real provider acceptance needs a renewed Page Token stored securely in the app and the rotated App Secret/application webhook configuration described below. The connection stays revoked. Backend health remained `ok` on PID 53916. This verification changed documentation only, so another backend restart is not applicable; the previous 119-test build and runtime E2E remain the latest code validation.

## Latest checkpoint — media and recovery completion, 03/10/2026

**STATUS: IMPLEMENTED and verified locally for inbound media/recovery; BLOCKED_BY_PROVIDER for real Meta acceptance.** This checkpoint supersedes the earlier F06 implementation and test/restart counts below.

- Inbound media now uses a secure provider media fetcher and Chatwoot multipart upload. Public DNS is validated and pinned per connection; HTTPS/domain/redirect policies, deadline, MIME/magic checks and 12 MB file / 24 MB message / five-attempt limits apply. Binary media is persisted in Chatwoot Active Storage. Unsupported media is visible; transient media preparation failure retries before any remote message write. Raw media references remain local; AI remains inhibited on media input because the model path does not understand its contents.
- Real media testing exposed and fixed the local Active Storage `localhost` versus `127.0.0.1` origin mismatch. Alias handling is confined to the configured loopback protocol/port and Active Storage path; foreign URLs/redirects remain blocked.
- Reconciliation now resolves public/private operation results even when callback outbox already exists, applies human takeover for recovered human public messages, and performs a full manual scan. Historical missing sends stay unknown. Outbound attachment messages explicitly fail instead of silently dropping files; provider upload/send remains NOT VERIFIED and the composer remains disabled.
- Meta relay now has an idempotent hidden launcher with exact process ownership checks. Relay PID 90288 verified: operator API 404; Meta challenge reaches backend and is rejected 403 while connection is revoked. Existing named tunnel PID 73240 uses remotely managed ingress; local command line provides no destination evidence. Its remote ingress still needs operator configuration/verification.
- Tests/build: `npm run build` PASS, typecheck plus **119/119** tests. Existing **5 UI/relay + 5 callback POC tests PASS**. New coverage includes media policy/MIME/size, multipart body, workspace boundary, preparation retry, private/public operation recovery, historical hold and outbound media rejection. No new dependencies or destructive migrations.
- Live acceptance: pinned HTTPS media fetch PASS (public test image); Chatwoot display 19 binary upload/download byte-identical PASS. Runtime display 20 webhook duplicate, AI reply, human reply and private-note isolation PASS. An incoming test image uploaded to display 20 was returned by the current Tinix message API and proxy with byte-identical data; DTO contained only the Tinix proxy URL. Manual reconciliation returned 200. These are controlled synthetic tests, not real Meta customer acceptance.
- Final runtime verification at 16:01 UTC+7: the earlier backend PID 24600 was already stopped. Started the normal project backend in a managed terminal session, **PID 53916**, after the final reconciliation delivery-status change and passing build/tests. Health and operator API returned 200; port 3182 belongs to this new process. Relay launcher started **PID 58484** on 3184; operator API returned 404 and revoked Meta challenge returned 403. Runtime synthetic display **21** passed duplicate webhook, single AI response, human takeover/reply and private-note isolation. No active task interruption was observed because the old backend had already exited. This round changed no frontend script.
- Changed files this round: new `src/services/attachment-fetcher.ts`, `scripts/start-meta-relay.ps1`, `tests/providers/inbound-media.test.ts`; Chatwoot client/provider, inbound/outbound/outbox/reconciliation, provider contract/predicate, errors, runtime wiring, relay launcher, media/recovery tests and live harness; OPERATIONS and this report. Schema/env/dependencies unchanged this round.
- Remaining external requirements: Meta app ID/rotated secret/verify token/callback URL are still absent from the actual local configuration; rotation flag false. Do not paste credentials into chat. Configure them securely, then verify Page permissions, webhook subscription and real messaging/media acceptance. Official Meta documentation again returned HTTP 429. Full tenant RBAC/release packaging are not certified by these messaging tests.

Multipart and content attributes were checked against [Chatwoot v4.18.0 MessageBuilder](https://github.com/chatwoot/chatwoot/blob/v4.18.0/app/builders/messages/message_builder.rb) and then verified with the real pinned local Chatwoot deployment. Rollback: use a forward fix or preserved source snapshot; no Git repository exists. Existing database/credential backups must be preserved and must not replace newer messages without a recovery/export step.

## Follow-up implementation — 03/10/2026

User authorized fixes after the review. The original findings below are retained as audit evidence; they describe the pre-fix snapshot.

**STATUS: READY WITH LIMITATIONS for local synthetic testing; NOT READY for real Meta customers.**

| Finding | Follow-up result |
|---|---|
| F01 exposed Meta secret | Source literals removed from controller and five scripts. Configuration requires operator-confirmed rotation; existing Meta connection is revoked on startup. Remote secret rotation remains BLOCKED_BY_PROVIDER/operator action. |
| F02 public operator surface | Unauthenticated external-host/proxied API calls fail closed; cross-origin operator calls rejected. Dedicated Meta webhook relay and launcher target port 3184. Existing externally managed tunnel ingress still needs verification/reconfiguration. Shared operator token is not tenant RBAC. |
| F03 false connected | Provider-specific token inspection/subscription moved behind Meta client; validate PAGE token, app ID, scopes and subscription response. Provision through ConversationProvider; configured account/callback URL; require API inbox identifier and actual callback `secret`. No fallback inbox or success after provisioning failure. Live rotated Meta provisioning NOT VERIFIED. |
| F04 inbound recovery | Release claims before message-write phase; remote contact/conversation lookup supports mapping recovery. Incoming posts carry stable external source ID. Paginated reconciliation completes matching unknown claims without replay. Ambiguous writes stay unknown; older records without source IDs remain unresolved. |
| F05 AI control | Human public sends take over; hybrid cannot auto-send; feature flags enforced for eligibility/dispatch/ingestion. Durable AI operation/version before Chatwoot POST; callback origin recovery and final outbox handoff/version guard. Fresh UI mode agrees with backend. |
| F06 media | PARTIAL: retain normalized references locally and in Chatwoot content attributes; visible unsupported-media notice; no AI auto-response. Binary media import remains unsupported. |
| F07 callback reconciliation | Startup/60-second paginated sweep with persisted baseline/watermark and overlap. Semantic message dedupe; atomic outbox/projection transaction. Older missing messages held unknown by manual sweep rather than automatically resent. |
| F08 batch starvation | Filter connected/degraded channels in SQL before LIMIT; dispatch by exact primary key. |
| F09 wrong conversation body | Request version and active conversation checks prevent stale success/error rendering. |
| F10 duplicate composer | Pending guard, captured conversation, newer-draft preservation; stable operationId retained in sessionStorage; durable backend claims/results prevent second write for the same operation. HTTP clients must supply operationId. |
| F11 destructive disconnect | Preserve channel as disconnected tombstone; history mapping remains; public send/dispatch/ingestion blocked. Reconnect reuses connection ID/binding; enable alone cannot reconnect. |

**CHANGED FILES:** services inbound/outbound/outbox/reconciliation; agent handoff/router; API Inbox/server/webhook/callback; repositories/schema; core types/provider contract; Chatwoot client/provider/mapper/predicate; env/flags; native UI; Meta connection client; webhook relay/TUNNEL-META launcher; five credential-bearing utility scripts; regression tests; live Chatwoot harness; `.env.example` and `OPERATIONS.md`. No dependency changes or commit. Git repository is absent; comparison used the audit SHA256 baseline.

**MIGRATIONS:** additive `send_operations` table via existing schema initialization. Existing cursor table is now used. Channel status adds `disconnected`; no data deletion. Runtime startup revokes Meta connections whose app credentials lack confirmed rotation or differ from configured secret.

**CONFIG:** new Meta app/verify/rotation fields and Chatwoot callback URL; secure operator API checks; dedicated relay 3184. Actual `.env` secrets were not changed or copied into reports. See OPERATIONS for required configuration.

**TESTS / BUILD:** `npm run build` PASS, typecheck plus 110/110 TypeScript tests. `node --test tests/poc/*.test.mjs` PASS 5/5 (UI races/relay). `node --test poc/chatwoot-v418/receiver-lib/callback.test.mjs` PASS 5/5. No lint script exists. Tests updated for intentional fresh-AI default, retained disconnect rows, and versioned AI dispatch.

**E2E:** live Chatwoot PASS (display 16: incoming/duplicate, remote identity reuse, outgoing, assignment/status); live Gemini text/tool PASS. Backup/restore drill PASS with decrypted credentials verified only on isolated copy. New runtime live synthetic display 17 PASS: duplicate webhook ACK, one inbound, one AI message/accepted outbox, human takeover/reply, private note absent from outbox, two accepted outbound messages total.

**RESTART:** exact old backend PID 108776 verified by command line and process current working directory `D:\___TOOLS\__TINIX\Tinix Inbox`. Replaced with hidden Node process PID 90516 at 09:02:20 UTC+7, after final code changes. Old PID gone, port owner changed, health ok, served HTML contains new request/submission guards. No active inbound claim or sending outbox at interruption. Existing browser tab needs reload to execute the new inline script; static frontend has no HMR.

**KNOWN LIMITATIONS / PROVIDER BLOCKERS:** Meta secret must actually be rotated in Meta console, configured securely and connection reverified. Current official Meta docs returned HTTP 429 during verification; target version/app permissions still need live verification. Binary media import unsupported; old unknown delivery outcomes require evidence, not blind retry. Full production RBAC/release pipeline/provider acceptance remain outside verified scope. No claim of production readiness.

**SECURITY / ROLLBACK:** source scan found zero remaining hardcoded Meta secret/Page-token candidates in src/scripts/public/poc. Database remains encrypted; do not expose backup/key files. Pre-change SQLite backup: `backups/tinix_inbox_2026-10-03T01-33-57-334Z.db`. No Git snapshot of source exists, so code rollback requires retained originals or forward fix. Old code must not be used with the new disconnected state, send claims or security policy; database restoration can discard subsequent messages and should occur only after preserving them.

**NEXT STEP:** rotate/configure Meta credentials, verify external tunnel targets webhook relay, perform real provider acceptance and implement binary media import before release.

## STATUS

**NOT READY** — chưa nên dùng với khách hàng thật.

Review thực hiện trong phiên 02–03/10/2026, múi giờ UTC+7. Không sửa source, test của project, dependency, launcher, schema hay runtime configuration. Chỉ tạo báo cáo này; harness tái hiện được lưu trong thư mục TEMP.

Kết quả trên source hiện tại: **10 MUST FIX BEFORE RELEASE**, **1 SHOULD FIX BEFORE RELEASE**. Các triệu chứng AI được gộp thành một finding về quyền điều khiển; retry inbound và recovery unknown được gộp thành một finding về phục hồi inbound. Không gọi những lỗi này là regression vì không có Git/history để so sánh.

Các kiểm tra tự động và E2E synthetic/live cơ bản pass. Quyết định NOT READY dựa vào lỗi đã tái hiện về xác thực webhook, ghi đè kết nối, mất nội dung media, phục hồi tin nhắn và gửi sai khi UI/handoff không nhất quán; không dựa vào polish hoặc các channel nằm ngoài MVP.

## BASELINE

- `git status --short`: FAIL, `fatal: not a git repository`. Không có `.git` ở project/ancestor; không thể xác định uncommitted changes, revision hay regression baseline.
- Trong khoảng review có 9 source/UI files thay đổi bởi công việc khác: index, Gemini/router, Inbox/server/webhook controllers, repositories, inbound service và UI. Tôi không tạo các thay đổi đó. Đã reread phần thay đổi, rerun build và toàn bộ fault harness trên snapshot mới. Build hiện tại 99/99; bản cũ 97/97. Lỗi fixed connection ID của Fanpage đã được khắc phục và được loại khỏi kết luận hiện tại. F03 chỉ còn false connected/provisioning. F11 đánh giá delete mới trên source hiện tại.
- Hash check sau revalidation: 0 source/UI/script/test files thay đổi thêm. Final read-only DB integrity vẫn ok; current Meta binding inbox 5, signing secret vẫn trùng source literal. Final restore drill: 2 connections, 5 conversations, 22 messages, 7 outbox rows; 2 credentials decrypt/rotate thành công trên copy. Không dùng snapshot ban đầu để giả định DB hiện tại chưa đổi.
- Stack thực tế: Node.js v24.18.0, npm 11.16.0, TypeScript type stripping; SQLite `node:sqlite`, WAL; HTML/CSS/JavaScript trực tiếp; HTTP REST/SSE; worker trong cùng process; Chatwoot CE v4.18.0, PostgreSQL/Redis/Sidekiq trong Docker.
- Runtime kiểm tra: loopback `127.0.0.1:3182`, `NODE_ENV=development`, Gemini đã cấu hình, operator token chưa cấu hình. Chatwoot API trả 200. UI mở được; SSE kết nối được.
- SQLite active ban đầu: 2 connections, 3 conversations, 16 message links, 3 outbox rows; `PRAGMA integrity_check = ok`. Có sẵn 2 inbound claims `unknown`, 2 provider events `failed`, 2 AI message links chưa có outbox. Đây là trạng thái đã tồn tại khi đọc baseline, không phải lỗi được tạo bởi harness.
- `AGENTS.md`, `DEVELOPMENT_WORKFLOW.md`, `PLAN.md`, `PLAN_TinixInbox_V2.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md`, `RESEARCH_Chatwoot.md`, research templates, `UI_UX.md`, phase reviews, operations và các tài liệu hướng dẫn đã được đối chiếu với các luồng implementation liên quan. Không có deeper AGENTS trong source.
- Không có `PLAN_TinixInbox.md` đúng tên mà AGENTS nhắc tới; dùng nội dung V2 trong `PLAN_TinixInbox_V2.md`. `PLAN.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md`, `RESEARCH.md`, `RESEARCH_COMPARISON.md` còn là template/TBD, không chứng minh implementation hoàn tất.
- Không có `RELEASE_WORKFLOW.md`. Runtime profile xác nhận chưa có packaging/updater/release pipeline cho V1.
- Documentation stale: OPERATIONS nói không có npm build, nhưng `package.json` có `build`; phase reviews còn nói chỉ có synthetic, Gemini và callback chưa live-verified, trong khi phiên này xác nhận Meta connection tồn tại, Gemini live pass và signed callback synthetic tới Tinix hoạt động. Tài liệu cũng nói production từ chối non-loopback, nhưng code cho phép khi operator token đủ dài. Các khác biệt được ghi nhận tại đây, không sửa tài liệu khác.

## TEST / BUILD RESULTS

| Check | Result | Phạm vi / giới hạn |
|---|---|---|
| `npm run build` | PASS | Rerun cuối: `tsc --noEmit` và 99/99 `.test.ts`; baseline trước thay đổi ngoài review: 97/97; không tạo distribution artifact |
| Typecheck | PASS | Đã chạy trong build |
| Unit/integration/hardening/E2E suite | PASS | 99 tests hiện tại, 0 fail/skip; nhiều provider tests dùng fake HTTP |
| `node --test tests/poc/callback-relay.test.mjs` | PASS | 2/2; không nằm trong glob `.test.ts` của npm test |
| `node --test poc/chatwoot-v418/receiver-lib/callback.test.mjs` | PASS | 5/5; signature/predicate POC |
| `npm run drill:backup-restore` | PASS | Snapshot live WAL, restore vào TEMP, kiểm count/integrity/decryption/key rotation; không thay DB active |
| `npm run test:live-chatwoot` | PASS | Contact/conversation mapping, một incoming sau duplicate, public outgoing, assignment, resolve/reopen trên CE thật |
| `npm run test:live-gemini` | PASS | Text generation và `lookup_order` Function Calling; tool data là demo trong script, không xác minh đơn hàng thật |
| Live synthetic → Tinix → Chatwoot → Gemini → signed callback → outbox | PASS | Rerun trên runtime mới: display 14, một inbound, một AI message, một provider-accepted synthetic send sau hai webhook giống nhau |
| Live human reply / private note / takeover | PASS | Public human message có outbox; private note không có outbox; takeover lưu mode human |
| `npm audit --omit=dev --json` | PASS | 0 reported production dependency vulnerabilities; không thay thế audit ứng dụng/Node/Docker |
| Lint | N/A | Không có lint command riêng |
| Packaged/release build, installer/updater | N/A | Chưa có pipeline/artifact để chạy |
| Fault/scenario harness | REPRODUCED | Rerun cuối 11 backend/security cases và 2 UI cases; assertions xác nhận hành vi lỗi, không phải acceptance pass |

Artifacts tái hiện (TEMP, không sửa project):

- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/reproduce.mjs`
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/reproduction-results.log`
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/current-reproduction.log` — kết quả source hiện tại; ưu tiên file này so với baseline log.
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/ui-simulation.mjs`
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/live-synthetic.log`
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/current-live-synthetic.log` — E2E rerun cuối.
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/final-build.log` — 99/99.
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/live-chatwoot.log`
- `C:/Users/Admin/AppData/Local/Temp/tinix-final-review-20261002/live-gemini.log`

Harness chạy import implementation thật với DB in-memory/fake downstream; UI simulation thực thi trực tiếp các function trích từ `public/index.html` trong VM. Không dùng harness để tuyên bố provider production-ready. Một lỗi key mismatch của harness được sửa trong TEMP trước khi rerun thành công; không phải lỗi sản phẩm.

## CRITICAL FINDINGS

### F01 — Secret xác thực webhook Meta nằm trong source và đang được connection active sử dụng

- **Severity:** CRITICAL.
- **Problem:** `connectMetaPage()` đưa App Secret literal vào credentials. Connection Meta active giải mã được và App Secret của nó trùng literal đó. Không chỉ là ví dụ/test fixture.
- **Evidence:** Source hiện tại `src/api/inbox-controller.ts:462–464,619–625`; `src/channels/meta/meta-adapter.ts:25–46`; `src/api/webhook-controller.ts` resolveWebhookSecret. Read-only inspection chỉ xuất boolean `metaSigningSecretMatchesSourceLiteral: true`, không xuất secret. Bản hiện tại còn dùng literal để tạo App Access Token cho debug_token.
- **User impact:** Ai có source literal và có thể tới webhook endpoint có thể tạo chữ ký hợp lệ để đưa customer events giả vào pipeline trusted, kích hoạt AI/tools và làm sai lịch sử. Source sharing/backup làm lộ credential dùng xác thực provider.
- **Reproduction:** Harness đọc literal vào memory, ký một payload synthetic bằng HMAC và gọi verifier thật: `accepted: true`. Không gửi webhook giả vào server active.
- **Recommended fix:** Rotate App Secret đã lộ, cấu hình qua secret store và encrypted credentials theo connection/app; loại literal khỏi source và các script có cùng giá trị. Retest signature hợp lệ/không hợp lệ với credential mới. Không chỉ xóa literal mà giữ secret cũ.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

## HIGH FINDINGS

### F02 — Launcher tunnel Meta công khai toàn backend trong cấu hình operator API không có auth

- **Severity:** HIGH.
- **Problem:** `TUNNEL-META.bat` tunnel nguyên `http://127.0.0.1:3182`; server chỉ yêu cầu token nếu token đã cấu hình. Runtime hiện tại không có operator token. Bind loopback không bảo vệ khi cloudflared/proxy forward request từ Internet.
- **Evidence:** `TUNNEL-META.bat:36`; `src/api/server.ts:143–154`; read-only GET `/api/connections` và `/api/conversations` không auth đều trả 200. Routes send/takeover/resume/lifecycle/reconcile/create connection nằm sau cùng optional-auth condition. UI chỉ dùng fetch/EventSource không gắn token, nên bật token đơn thuần cũng chưa làm native UI dùng được.
- **User impact:** Khi chạy launcher theo hướng dẫn, người có URL có thể đọc conversation/media và gọi privileged operations. Đây là cấu hình deployment cụ thể do project cung cấp, không phải yêu cầu thêm RBAC tổng quát.
- **Reproduction:** Đọc command tunnel và gọi API local không token; 200. Không tạo tunnel mới, không thử write từ Internet. Có cloudflared process trên máy nhưng chưa xác minh ingress công khai của process đó; không kết luận URL hiện tại đã bị khai thác.
- **Recommended fix:** Meta webhook relay chỉ forward đúng webhook/challenge routes đã allowlist; không forward `/api`, UI/media/operator actions. Fail closed khi public deployment không có auth; nếu hỗ trợ operator remote, hoàn thiện authenticated UI/API/SSE và workspace boundary trước rollout.
- **Release decision:** **MUST FIX BEFORE RELEASE** cho topology tunnel đang hướng dẫn.

### F03 — Kết nối Fanpage báo connected dù subscribe/provisioning lỗi và dùng inbox fallback

- **Severity:** HIGH.
- **Problem:** Source mới đã dùng lookup workspace/provider/account và unique connection ID cho Page khác nhau. Tuy nhiên subscribe/provision failures vẫn bị bỏ qua; fallback inbox 4 vẫn được lưu connected và nhiều Pages có thể cùng fallback vào inbox đó.
- **Evidence:** `src/api/inbox-controller.ts:568–615,630–672`, đặc biệt fallback tại `576`. Account 1 và callback URL POC cũng hard-code trong provisioning path.
- **User impact:** Người dùng thấy kết nối thành công dù inbound/outbound chưa hoạt động; missing callback secret làm callback rejected. Inbox fallback của Page khác có thể làm sai account/inbox identity routing.
- **Reproduction:** Rerun fake inspection trả Page A rồi B, subscription/Chatwoot provisioning HTTP 403: cả hai success; DB có 2 distinct connection IDs, cả hai connected, cùng inbox fallback 4 và thiếu signing secret. Việc giữ Page identity nay PASS; false connected vẫn FAIL.
- **Recommended fix:** Bỏ inbox fallback; kiểm HTTP/schema/scopes/subscription, xác nhận đúng account-specific binding và callback secret trước connected. Provisioning fail phải giữ pending/degraded và hướng dẫn retry; dùng configured account/callback được duyệt.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F04 — Lỗi Chatwoot tạm thời làm inbound không phục hồi dù service đã trở lại

- **Severity:** HIGH.
- **Problem:** Mọi exception sau claim đều biến claim thành `unknown`, kể cả HTTP 503 trước khi tạo contact/message. Worker lên lịch retry nhưng lần sau bị `InboundOutcomeUnknownError` non-retryable; event chuyển failed. Không có inbound reconciliation/recovery action hoàn chỉnh để xử lý claim này.
- **Evidence:** `src/services/inbound-service.ts:135–141,296–305`; `src/api/webhook-controller.ts` processPendingProviderEvents; `src/persistence/repositories.ts` inbound claims. Chatwoot incoming create cũng không lưu `externalMessageId`/`source_id` remote, làm đối soát ambiguity khó hơn.
- **User impact:** Provider đã được ACK, nhưng tin khách không hiện trong Inbox khi Chatwoot outage ngắn. Raw payload còn trong DB, chưa bị xóa; mất khỏi operational workflow và không tự phục hồi.
- **Reproduction:** ensureIdentity trả typed HTTP 503 trước mọi write; sau phục hồi, identity chỉ được gọi 1 lần, incoming create 0; event `retry_wait → failed`, claim unknown. DB active baseline cũng có 2 unknown claims, nhưng chưa khẳng định nguyên nhân của hai rows đó.
- **Recommended fix:** Phân biệt bước chưa có side effect/definitive rejection với remote write có outcome bất định. Cho retry an toàn của bước chưa commit; giữ unknown cho ambiguity thật và cung cấp reconciliation dựa external source identity cùng redrive có kiểm chứng. Retest outage thật ở từng boundary.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F05 — Quyền điều khiển AI không nhất quán giữa UI, human reply, feature flag và outbox

- **Severity:** HIGH.
- **Problem:** Không có state record thì policy cho AI trả lời nhưng conversation DTO hiển thị paused. Human send không chuyển takeover; HYBRID vẫn canReply và gửi tự động. Feature flags khai báo nhưng không được runtime sử dụng. Version check chỉ trước async outgoing POST, không có guard cuối tại outbox.
- **Evidence:** `src/agent/handoff-policy.ts:18–50,99–121`; `src/api/inbox-controller.ts:196,281–335`; `src/agent/inbox-agent-router.ts:145–168`; `src/services/outbox-service.ts:63–100`; `src/config/feature-flags.ts`; tìm toàn src chỉ thấy manager tại module định nghĩa.
- **User impact:** Người dùng thấy AI paused, gửi phản hồi hoặc tắt AI flag nhưng AI vẫn có thể trả lời. Takeover trong lúc outgoing HTTP đang chờ cũng không chặn callback/outbox sau đó. Có thể double reply hoặc gửi nội dung AI sau khi human đã nhận việc.
- **Reproduction:** DTO fresh trả paused, policy canReply true, human send xong canReply vẫn true. Flag `tinix_inbox_ai_enabled=false` vẫn tạo outgoing AI. Deferred outgoing POST → takeover → resolve POST → signed callback thật → synthetic outbox dispatch tạo 1 provider send trong mode human.
- **Live corroboration:** Browser trên conversation test hiển thị `AI đang tạm dừng`/PAUSED nhưng timeline có AI replies; read-only baseline không có AI state cho fresh conversation. Không suy ra mọi AI message cũ đều gửi sai.
- **Recommended fix:** Một eligibility policy authoritative cho UI/router/outbox, bao gồm global/channel flag, explicit mode và generation version; HYBRID chỉ suggestion. Human reply/public callback phải áp dụng policy takeover được duyệt. Lưu origin/version để outbox recheck trước provider dispatch, với trạng thái skip/cancel và audit rõ ràng.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F06 — Media inbound bị bỏ trước khi ghi Chatwoot

- **Severity:** HIGH.
- **Problem:** Meta/Zalo normalization có attachments, inbound chuyển chúng vào provider contract, nhưng `ChatwootConversationProvider.createIncomingMessage()` chỉ POST text, message_type, private. Image-only trở thành content rỗng; media không được lưu cho operator.
- **Evidence:** `src/channels/meta/meta-normalizer.ts:28–40`; `src/services/inbound-service.ts:237–246`; `src/providers/chatwoot/chatwoot-provider.ts:116–127`; `src/providers/chatwoot/chatwoot-client.ts:127–145`.
- **User impact:** Ảnh sản phẩm, biên nhận, chứng từ hay file khách gửi không có trong lịch sử; text kèm ảnh chỉ còn text. Attachment proxy tốt cho media đã ở Chatwoot không giải quyết ingress này.
- **Reproduction:** Gửi provider contract image-only với một attachment; fake HTTP bắt request thật: content empty, không attachments. Harness không download URL/customer media thật.
- **Recommended fix:** Download/upload media an toàn theo approved hybrid strategy, bounded size/MIME/origin, durable metadata/reference và multipart Chatwoot upload. Nếu chưa hỗ trợ, lưu explicit unsupported media event/metadata và hiển thị limitation, không ACK processed như đủ nội dung.
- **Release decision:** **MUST FIX BEFORE RELEASE** cho use case Meta có inbound media thông thường.

### F07 — Reconciliation không tự chạy và chỉ đọc trang tin nhắn gần nhất

- **Severity:** HIGH.
- **Problem:** Bootstrap không schedule startup/periodic reconciliation; UI POST là trigger duy nhất. Provider reconcile dùng listMessages không before/window cursor. Callback mất quá một trang lịch sử thì manual reconcile vẫn không tìm được.
- **Evidence:** `src/index.ts` bootstrap/background loops; `src/api/server.ts:306` (route reconcile); `src/services/reconciliation-service.ts:28–45`; `src/providers/chatwoot/chatwoot-provider.ts:313–330`; schema có cursor nhưng service không sử dụng.
- **User impact:** Human/AI outgoing đã tồn tại Chatwoot có thể không tới provider sau callback outage, dù user nhấn đối soát. DB active baseline có 2 AI messages chưa có outbox, minh chứng gap tồn tại, chưa quy nguyên nhân chính xác cho từng message.
- **Reproduction:** Provider có 30 outgoing, fake endpoint trả 20 latest khi không before. Reconcile hai lần chỉ lấy latest; queued 20, lần sau 0, older message không được recovered và không request nào có before.
- **Recommended fix:** Startup/periodic durable sweep với pagination, overlap/watermark, bounded batches, semantic dedupe; chặn resend unknown/sent đã biết. Đồng bộ trạng thái callback processing và recovery sau crash, không chỉ ghi receipt.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F08 — Outbox của kênh tạm dừng có thể chặn tất cả kênh đang hoạt động

- **Severity:** HIGH.
- **Problem:** Worker lấy oldest LIMIT 10 trước, rồi skip disabled; các rows này không đổi state/thời gian. Mỗi tick lại lấy cùng 10 rows. Active rows sau đó không bao giờ được chọn nếu không có immediate dispatch thành công.
- **Evidence:** `src/persistence/repositories.ts:685–696`; `src/services/outbox-service.ts:39–58`; bootstrap batch 10 tại `src/index.ts:167`. Immediate dispatch cũng chỉ lookup pending 100 nên không bảo đảm tránh backlog.
- **User impact:** Pause một kênh có queue làm đình trệ recovery/retry của các kênh khác; frontend có thể chỉ thấy queued kéo dài.
- **Reproduction:** 10 oldest pending thuộc disabled channel, row thứ 11 thuộc active channel; chạy 3 worker rounds batch 10: 0 sends, row active vẫn pending. Trạng thái selection không đổi nên lặp vô hạn khi paused giữ nguyên.
- **Recommended fix:** Filter eligible enabled connections trước LIMIT, hoặc scanning batches có tiến độ/fairness; vẫn giữ paused rows bền vững để resume. Cover multi-channel paused backlog và active retry/restart recovery.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F09 — Response lịch sử cũ ghi đè hội thoại mới đang chọn

- **Severity:** HIGH.
- **Problem:** `loadMessages(A)` cập nhật `messagesArea` sau await mà không kiểm active conversation/request generation. Khi user chọn B và request A trả chậm, header/recipient là B nhưng body là A. Polling/SSE cũng có thể tạo các request chồng nhau.
- **Evidence:** Source hiện tại `public/index.html:1041` loadMessages, `1185` handleSendMessage và polling cuối file; request history không selected-ID/generation guard.
- **User impact:** Nhân viên đọc nhầm câu hỏi/lịch sử và gửi phản hồi cho khách B dựa nội dung khách A; rủi ro trả lời sai hoặc tiết lộ thông tin khách.
- **Reproduction:** VM chạy function UI thật: defer history A, load history B, release A. Active conversation vẫn B, DOM chứa HISTORY_A. Không tạo write tới khách thật.
- **Recommended fix:** Abort/generation guard và kiểm selected ID trước render/catch/finally; giữ result trong cache đúng conversation nhưng chỉ render selected request. Composer snapshot conversation ID trước await.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

### F11 — Xóa connection làm lịch sử cũ không đọc được và reconnect không khôi phục mapping

- **Severity:** HIGH.
- **Problem:** Delete mới xóa cứng row channel_connections nhưng giữ conversation/message/outbox links tham chiếu ID cũ. Provider đọc history bắt buộc join connection đó. Reconnect tạo connection ID mới nên không khôi phục các references cũ.
- **Evidence:** `src/api/inbox-controller.ts:675–682`; `src/persistence/repositories.ts:132–138`; `src/providers/chatwoot/chatwoot-provider.ts:58–66,142–150`; `public/index.html` handleDeleteConnection. Confirm UI chỉ nói ngừng nhận/gửi, không nói mất khả năng truy cập lịch sử.
- **User impact:** Xóa kênh để cấu hình lại làm conversation cũ vẫn hiện trong list nhưng history/attachment load fail; queued outbox cũ không dispatch được. Dữ liệu remote còn nhưng native app mất đường truy cập, cần sửa DB mapping thủ công để recovery.
- **Reproduction:** In-memory DB có connection + historical conversation/message; delete trả success, historical rows còn; provider listMessages throw mapping error. Tạo replacement connection vẫn không đọc history được. Không xóa connection active.
- **Recommended fix:** Soft disconnect/tombstone, giữ binding phục vụ read-only history và reconnect cùng identity; cancel/hold queued sends theo policy rõ. Nếu xóa configuration thật, bảo toàn archive mapping và migration/recovery được kiểm chứng.
- **Release decision:** **MUST FIX BEFORE RELEASE**.

## MEDIUM FINDINGS

### F10 — Double-submit hoặc retry request có thể tạo hai phản hồi giống nhau

- **Severity:** MEDIUM.
- **Problem:** Send button/Ctrl+Enter không có in-flight guard; body không client operation ID. Backend tạo một Chatwoot message mới cho mỗi POST; outbox dedupe theo Chatwoot ID không dedupe hai creations khác ID.
- **Evidence:** `public/index.html:1185` handleSendMessage và Ctrl+Enter listener cuối file; `src/api/server.ts` message POST route; `src/api/inbox-controller.ts:301–315`; `src/providers/chatwoot/chatwoot-provider.ts:129–140`.
- **User impact:** Nhấn hai lần lúc mạng chậm hoặc gửi lại sau mất response có thể gửi trùng cho khách.
- **Reproduction:** Hai calls handleSendMessage trước response đầu tạo 2 POST cùng content. Các request đều đi vào remote create path; đây là duplicate operation, không phải duplicate callback mà suite đã cover.
- **Recommended fix:** Disable/guard pending submission; stable client operation ID với durable server claim/idempotency và outcome recovery trước cho retry request bất định. Không chỉ thêm debounce.
- **Release decision:** **SHOULD FIX BEFORE RELEASE**.

## REGRESSION RISKS

- Không có Git/history: không kết luận finding mới là regression hoặc là lỗi đã được fix rồi tái xuất hiện.
- Automated baseline không có failure. Các findings là behavior hiện tại ngoài coverage phù hợp của suite, không phải test regressions do review.
- Shared inbound claim/outbox selection ảnh hưởng mọi adapter; shared UI message loading ảnh hưởng mọi hội thoại; F11 làm orphan identity mappings lịch sử. Source mới giữ separate Page IDs nhưng F03 provisioning vẫn fail.
- Handoff unit test có takeover giữa generation pass, nhưng không bao phủ outgoing POST đang in-flight/callback/dispatch sau takeover; hai điều này không mâu thuẫn.
- Feature flags chưa là rollback mechanism thực sự; không được dựa vào chúng để tắt transport/AI khi rollout lỗi.

## DATA INTEGRITY

- PASS: SQLite integrity; durable event insertion trước webhook ACK; unique inbound/outbox mapping; atomic outbox send claim; duplicate signed callback stress test; WAL snapshot/restore/key rotation trên copy.
- FAIL: F03 binding/provisioning false success, F04 stuck inbound sau outage, F06 bỏ media, F07 thiếu complete recovery, F11 orphan historical mappings. F09 có thể dẫn thao tác đúng recipient ID nhưng dựa dữ liệu hiển thị sai.
- Interrupted outbound sending chuyển unknown và không tự resend là behavior an toàn đã test; recovery/operator resolution chưa đầy đủ.
- Các bước callback receipt → outbox → message projection là nhiều writes, không một transaction; callback event repository chưa có processing/replay worker. Đây được xem trong F07, không tăng thành một issue khác.
- Additive schema migrations có tests; không thử destructive migration/downgrade trên DB active. Key envelope v2 rollback cần DB snapshot/key tương ứng theo OPERATIONS.
- Live synthetic acceptance tạo conversation test display IDs 13 và 14 (rerun current runtime), mỗi conversation có một inbound, một AI public reply, một human public reply, một private note; mode cuối human. Live Chatwoot script tạo POC display ID 12. Record test giữ để đối chiếu, không xóa dữ liệu. Không gửi Meta/Zalo hoặc message tới khách thật.

## SECURITY

- MUST FIX: F01 active signing secret hard-code; F02 whole-backend tunnel + optional operator auth.
- PASS trong phạm vi đã test: encrypted channel/callback credentials với authenticated AES-GCM; public DTO không chứa credentials; callback HMAC/timestamp; invalid callback mapping rejected; static path traversal containment; 1 MB body limit; attachment same-origin redirect restriction, 12 MB cap, safe MIME/disposition.
- Operator token code không tương đương workspace auth/RBAC. Generic create connection có workspace field và get-by-ID paths không nhận authenticated tenant scope; chỉ coi đây là local single trusted operator mode, không claim multi-tenant production-ready.
- Không đưa secret/token/raw customer payload vào báo cáo. Secret chỉ được so sánh/ký trong memory cho harness. Không thử khai thác remote hoặc gửi forged webhook active.
- Docker runtime hiện đặt `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true`, khác phase docs nói local callback bị chặn. Đây là bypass toàn SafeFetch được xác nhận bằng inspect boolean. POC callback live chạy trong cấu hình đó; không đủ bằng chứng chấp nhận cấu hình ấy cho production. Cần approved narrow HTTPS callback topology trước rollout.

## STABILITY / RECOVERY

- PASS: running backend health/UI/API, Chatwoot read API, real synthetic workers/callback, isolated restart-recovery unit tests, bounded retry tests, unknown-send no blind retry, durable backup/restore drill.
- FAIL: known temporary Chatwoot failure F04, disabled backlog F08, callback/history gap F07.
- Chatwoot generic HTTP requests không có application timeout (`src/providers/chatwoot/chatwoot-client.ts:17–32`); không chạy blackhole network/load test nên chưa định lượng ảnh hưởng và không tăng finding suy đoán.
- Start/stop/restart scripts hard-code port 3182 và xác định process qua port, không ownership evidence; không dùng chúng trong review để tránh kill project khác. Runtime profile configurable HOST/PORT chưa được launcher áp dụng đầy đủ; cần kiểm tra trước phân phối cấu hình khác local default.
- **Server restart bởi review: N/A cho audit/documentation-only task.** Tôi không sửa runtime code/config/build output; build noEmit. Không restart/interrupt server bởi audit. Công việc khác đã thay server: runtime hiện PID 108776, start 02/10 21:27:52, sau source/UI changes cuối cùng 21:25:31; final health 200. E2E current display 14 chạy trên runtime mới. Actual machine reboot/crash không được thực hiện; recovery logic dùng test DB.

## PERFORMANCE

- F08 là operational starvation đã tái hiện, không phải micro-optimization.
- Full suite stress có 100 duplicate callbacks/16 workers và concurrent inbound tests pass, nhưng không phải benchmark realistic multi-tenant media/conversation workload.
- Conversation list lấy toàn local message links từng conversation và UI poll 6 giây kể cả SSE connected. Không có workload/capacity evidence đủ để kết luận release blocker riêng cho các chi phí này.
- Chưa benchmark thousands of conversations, history depth, memory growth, prolonged SSE backpressure hoặc disk-full. Không tuyên bố capacity production dựa vào suite dưới một giây.

## RELEASE / UPDATE

- Không có installer/updater/package release artifact; `build` chỉ validation, không phải release bundle.
- Chatwoot CE web/Sidekiq pin exact `v4.18.0-ce` + digest trong compose và container đang chạy. PostgreSQL/Redis hiện dùng tags, deployment vẫn là POC.
- SQLite backup/restore và key rotation mechanics PASS; complete Chatwoot PostgreSQL + storage + config + secrets restore và upgrade/downgrade contract suite **NOT TESTED**.
- Node runtime, source và user data/.env/key phải được tách khi có distribution; hiện chưa có pipeline để chứng minh behavior update.
- Release acceptance còn mở: real Meta end-to-end, expiration/revoke/reconnect, media pipeline, callback outage recovery. Zalo PARTIAL/NOT VERIFIED; TikTok Shop/Shopee BLOCKED_BY_PROVIDER và send fail closed. Chúng không block Meta/core MVP nếu được công bố unavailable.

## MANUAL ACCEPTANCE

| Scenario | Result | Evidence / lý do |
|---|---|---|
| UI startup + list/history + contact/assignee UI | PASS | Browser thật; mở conversation test, timeline/status/assignment empty state xuất hiện |
| Backend/Chatwoot health/read API | PASS | HTTP 200; containers running, PG/Redis healthy |
| Real Chatwoot mapping + duplicate inbound | PASS | npm live POC, one remote incoming after duplicate |
| Synthetic HTTP inbound → Gemini → real signed callback → outbox | PASS | Current rerun display 14: inbound 1, AI 1, outbox accepted 1 |
| Live human reply / note protection | PASS | Human public outbox exists; private note outbox absent |
| Explicit takeover persists | PASS | Synthetic conversation lưu mode human |
| Takeover during AI generation | PASS | Existing automated test |
| AI eligibility/UI/flags/late takeover | FAIL | F05, deterministic implementation harness |
| Chatwoot transient outage → recovered inbound | FAIL | F04, real repositories/services with fake definitive 503 |
| Add second Page / failed provisioning | PASS / FAIL | Separate Page IDs nay PASS; F03 false connected khi 403 vẫn FAIL |
| Delete/reconnect preserves historical access | FAIL | F11, orphan mapping sau delete/new ID; không thao tác DB active |
| Incoming image preservation | FAIL | F06, intercepted provider HTTP body |
| Lost callback older than latest page | FAIL | F07, 30-message provider simulation |
| Paused channel backlog with another active channel | FAIL | F08, DB/services/adapters thật |
| Rapid A→B navigation, delayed history A | FAIL | F09, actual UI function simulation |
| Double submit | FAIL | F10, actual UI function simulation |
| Signature forged from source literal | FAIL | F01, verifier thật, no active forged POST |
| Webhook-only exposure with Meta tunnel | FAIL | F02, shipped tunnel forwards whole backend; no remote exploit test |
| Backup/restore/decrypt/rotation | PASS | Isolated drill trên active DB snapshot |
| Restart interrupted inbound/outbound | PASS | Existing test DB recovery cases; machine/process crash E2E NOT TESTED |
| Real Page customer receive/send + token revoke/reconnect | NOT TESTED | Không gửi tới khách thật; thiếu disposable authorized Page recipient cho live send |
| Zalo / TikTok Shop / Shopee authorized E2E | NOT TESTED | Provider access/acceptance chưa có; TikTok/Shopee sends intentionally blocked |
| Production n8n write idempotency/auth contract | NOT TESTED | Gemini live test dùng demo tool; workflow thực không được exercise |
| Public HTTPS callback deployment without global SafeFetch bypass | NOT TESTED | Current POC enables private network; không deploy/change proxy trong audit |
| Machine reboot, DB/filesystem outage, disk-full, multi-process crash | NOT TESTED | Không fault inject máy/DB active |
| Packaged update, full Chatwoot upgrade/rollback | NOT TESTED / N/A | Không có release pipeline; không đổi Docker/production schema |

## MUST FIX BEFORE RELEASE

1. **F01:** Rotate/remove active source-embedded Meta signing secret.
2. **F02:** Restrict Meta tunnel ingress to webhook routes; enforce operator auth for remote use.
3. **F03:** Fail closed on provisioning/subscription failure; remove arbitrary inbox fallback.
4. **F04:** Correct safe inbound retry and provide verified unknown reconciliation.
5. **F05:** Unify AI ownership/eligibility and guard final outbound after takeover.
6. **F06:** Preserve inbound media or explicitly reject/surface unsupported content without losing it.
7. **F07:** Durable, paginated startup/periodic reconciliation.
8. **F08:** Prevent paused channel rows starving enabled channel sends.
9. **F09:** Prevent stale history rendering into another conversation.
10. **F11:** Preserve read-only historical mapping when disconnecting/deleting and reconnecting channels.

**SHOULD FIX BEFORE RELEASE:** F10 durable human-send idempotency/pending guard.

Sau fixes, rerun fault scenarios + baseline + real disposable Meta acceptance. Không chỉ rerun 99 green tests rồi bỏ qua failures tái hiện trong review này.

## SAFE TO DEFER

- TikTok Shop/Shopee production support, Zalo rollout và real n8n tools khi ngoài core MVP, giữ fail-closed/unavailable và công bố rõ.
- Native outbound attachments khi composer vẫn disabled và limitation rõ; **không** gồm inbound media loss F06.
- Naming/style/refactor, UI polish, analytics/campaign features.
- Automated updater/installer khi vận hành local source là scope được chấp thuận. Không tuyên bố release/update đã verified.

Không tạo thêm recommendation cho naming, formatting hoặc speculative architecture.

## FINAL DECISION

**NOT READY. SAFE TO USE NOW: No** cho customer-facing production.

Local synthetic testing có thể tiếp tục. Automated baseline, live Chatwoot/Gemini và synthetic single outbound path đã pass, nhưng các lỗi identity, authentication, recovery và operator state đã xác nhận khiến việc dùng thật chưa an toàn. Cần hoàn tất 10 required fixes, ưu tiên cả F10, rồi đạt real channel/production topology acceptance trước thay đổi quyết định.
