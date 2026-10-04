# RESEARCH_Chatwoot

**Ngày nghiên cứu:** 2026-09-28 (UTC). **Phạm vi:** Chatwoot tự host, Community Edition (CE), đối chiếu với `PLAN_TinixInbox.md`, `AGENTS.md`, `UI_UX.md` được cung cấp. **Phiên bản nguồn:** tag `v4.18.0`, commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d` [S1]. Đây là báo cáo bằng chứng, không thay thế implementation plan hay POC chạy thật.

**Quy ước:** **[D]** tài liệu chính thức; **[C]** kiểm tra mã nguồn đúng tag trên; **[I]** suy luận kiến trúc; **[R]** khuyến nghị; **NOT VERIFIED** chưa có chứng cứ hoặc cần thử trong môi trường chạy. Liên kết `[S#]` ở cuối tài liệu trỏ đến nguồn chính thức; permalink mã nguồn cố định theo commit. Khi tài liệu và mã nguồn khác nhau, kết luận cho v4.18.0 dựa trên mã nguồn.

## Executive Summary

**READY WITH LIMITATIONS.** Chatwoot CE có API Inbox, Application REST API, account webhook, callback API Inbox, contact/conversation/message, assignment, notes và ActionCable; do đó kiến trúc **Tinix Channel Gateway → ChatwootConversationProvider → Tinix AI → n8n tùy chọn** khả thi về mặt tích hợp [S2–S8]. Chưa thể xác nhận production readiness chỉ từ docs/source: phải chạy POC end-to-end, thử callback khi receiver lỗi, mapping sau restart, phân quyền multi-tenant và giới hạn thực tế.

**Phát hiện chi phối thiết kế:**

1. API Inbox callback gửi các message event **cả incoming lẫn outgoing**, kể cả private note outgoing; account webhook cũng có thể phát cùng event nếu cùng đăng ký. Chỉ `outgoing && private === false`, đúng account/inbox và chưa xử lý `message.id` mới được tạo outbox. `activity` không qua message webhook; `template` có thể qua, cần policy riêng [S9–S11].
2. `WebhookJob` của account/API Inbox v4.18.0 không cấu hình retry riêng; `Webhooks::Trigger` bắt lỗi và log. Với API Inbox, lỗi callback `message_created/message_updated` có thể cập nhật message thành `failed`. Không có chứng cứ về guarantee giao hàng/thứ tự, delivery log hoặc replay API cho account/API Inbox webhook. Thiết kế **signal + durable receipt + reconciliation**, không xem callback là queue đáng tin cậy [S9,S10].
3. `ContactInbox.source_id` unique theo **inbox**, khác `Contact.identifier` unique theo **account** và `Message.source_id` (không có unique index). `Conversation.id` trong webhook thường là `display_id` của account; cần giữ cả internal/REST reference và mapping Tinix, tránh đồng nhất các loại ID [S12–S17].
4. Message mới mặc định `status=sent` dù provider của Tinix chưa xác nhận. Tinix phải quản lý `queued/sending/provider_accepted/delivered/read/failed/unknown` riêng và chỉ đồng bộ Chatwoot status khi có bằng chứng thích hợp [S11,S18].
5. CE không bao gồm Captain AI, SSO/SAML, SLA, custom roles/permissions, audit logs theo bảng self-hosted; **basic administrator/agent, inbox membership, assignment/team, labels, private notes và API/webhook** có trong core. Không đánh đồng “Roles & permissions” trả phí với basic account/inbox roles [S5,S19–S21].

## Research Scope

Đã kiểm tra tag `v4.18.0` bằng checkout source và tài liệu/release chính thức. Không có repository Tinix trong workspace: chỉ bốn tài liệu được đính kèm; vì thế không audit được stack, schema, deployment hoặc git status của Tinix. Không chạy Chatwoot/POC, không kiểm chứng provider Zalo, Meta, TikTok Shop, Shopee hay tải Docker image. Các nhận định về production là **khuyến nghị có điều kiện**. Không sửa ba tài liệu dự án.

## Versions and Sources

Release list chính thức đánh dấu `v4.18.0` phát hành 18-09-2026 là latest tại ngày nghiên cứu và khuyến nghị upgrade để nhận security fixes [S1]. Tag có Ruby `3.4.4`, Rails `7.2.3.1`, Sidekiq `7.3.10`, gem `pg 1.5.3`, `redis 5.0.6`; frontend Vue 3.5, Pinia 3, Vite 6.4.2 theo `.ruby-version`, `Gemfile.lock`, `package.json` tại tag [S22]. Các version gem client **không** chứng minh minimum PostgreSQL server; tài liệu yêu cầu PostgreSQL, khuyên bản stable mới và Redis >=7.0 [S23].

**Production baseline [R]:** dùng release tag, không nhánh `develop/master`; CE image versioned `v4.18.0-ce` theo pattern tài liệu, xác minh tag và digest thực tế trước deploy. Docker guide minh họa template từ `develop` và `latest`, nhưng dùng nguyên mẫu đó cho production sẽ khiến code/config trôi khác tag đã pin [S24].

## Chatwoot Architecture

**[D/C]** Rails web/API, PostgreSQL cho records, Redis cho Sidekiq/cache/ActionCable, Sidekiq worker riêng; Active Storage local/S3-compatible; dashboard Vue/Vite; ActionCable listener phát message/conversation events đến agent qua pubsub tokens [S22–S25]. Docker Compose và Helm được hỗ trợ. Reverse proxy TLS phải chuyển WebSocket Upgrade và header `api_access_token` có dấu gạch dưới (`underscores_in_headers on` trong ví dụ Nginx) [S24].

**[D]** Self-hosted hướng dẫn tối thiểu 4 GB RAM, 2 CPU; requirements mô tả 4 GB/10.000 conversations/ngày và 8 GB/20.000/ngày như hướng dẫn ước lượng, **không** là benchmark đảm bảo cho tải Tinix. PostgreSQL tối thiểu 5–10 GB trống ban đầu; Redis có thể bắt đầu 100 MB; worker có thể dùng >1 GB RAM [S23,S26]. Tách web, worker, DB, Redis và object storage về mặt vận hành; có thể cùng host ở POC.

## Community vs Enterprise

Repository root `LICENSE` áp MIT Expat cho phần ngoài `enterprise/`; `enterprise/LICENSE` có giấy phép khác, hạn chế sử dụng/phân phối khi không có quyền tương ứng [S19]. Bảng **self-hosted**, không dùng bảng giá Cloud [S5]. Bảng dưới phân biệt bằng chứng từ pricing với mã core; “Community” nghĩa là tính năng cơ bản nhìn thấy trong source CE, không cam kết mọi cấu hình vận hành.

| Capability | Community | Enterprise / paid self-hosted | Tinix cần? | Risk |
|---|---|---|---|---|
| API Inbox, Application API, account webhook, signed API callback | Có [C] [S6,S9,S20] | Có | Bắt buộc | Thấp, cần POC |
| Basic agent/admin, inbox membership, assignment, team | Có trong core [C] [S20,S21] | Có | Có | Vừa: quyền chi tiết khác |
| Labels, private notes, custom attributes | Có trong core/API [C] [S11,S20] | Có; **required conversation attributes** là paid [S5] | Có | Thấp/vừa |
| Captain AI, voice, agent capacity, custom branding | Không theo self-hosted pricing [D] [S5] | Có theo gói | Không | Thấp |
| Custom roles/permissions | Không theo self-hosted pricing [D] [S5] | Premium/Enterprise | Không cho MVP | Cao nếu cần RBAC tinh vi |
| SSO/SAML, SLA policies | Không [D] [S5] | Enterprise | Không cho MVP | Vừa nếu enterprise customer yêu cầu |
| Audit logs | Enterprise theo release/changelog [D] [S1,S27] | Có | Tinix tự log | Vừa |

**[R]** Tinix tự thực thi workspace RBAC và audit. Không dùng paid-only features như nền tảng bảo mật/AI của MVP. Phân quyền basic inbox ở CE vẫn phải kiểm thử với agent/admin thật; app API token hưởng quyền của owner.

## Core Data Model

| Entity | Quan hệ và ràng buộc v4.18.0 | Hệ quả cho Tinix |
|---|---|---|
| Account | Chứa contacts/inboxes/conversations/users; API account-scoped [S13,S17] | 1 account/Tinix workspace là mặc định |
| Inbox + `Channel::Api` | Inbox thuộc account, channel có `identifier`, `webhook_url`, `secret` [S6,S9] | Lưu `account_id`, `inbox_id`, channel identifier, secret lifecycle |
| Contact | `identifier`, email, phone unique trong account khi có giá trị; có nhiều ContactInbox [S13] | Tránh đặt provider ID trần trong identifier nếu có thể trùng cross-channel |
| ContactInbox | `(inbox_id,source_id)` unique; một contact nhiều inbox [S12] | Dùng source ổn định, namespace bởi connection nếu cần |
| Conversation | Gắn `contact_inbox`, inbox, contact, assignee/team; trạng thái `open/resolved/pending/snoozed` [S14,S15] | Một ContactInbox có nhiều conversations khi không lock |
| Message | `incoming/outgoing/activity/template`; `private`, sender polymorphic, source_id/status [S11] | `message.id` là dedupe outbound; provider IDs thuộc Tinix |

## API Channel

**[D/C]** API Inbox nhận name và callback URL; có thể tạo qua UI hoặc `POST /api/v1/accounts/{account_id}/inboxes` với `channel.type=api`; thêm agents vào inbox [S2,S6]. `Channel::Api.identifier` là định danh public inbox; **khác** numeric `inbox_id`. Hai API surface tồn tại:

- **Application API** `api_access_token` server-to-server: tạo/find contact, ContactInbox, conversation và incoming message; hỗ trợ private note, attachment, update message status [S7,S8,S16,S17]. Tinix nên dùng surface này với service user theo account [R].
- **Public Client API** `/public/api/v1/inboxes/{identifier}/...` dành cho customer interface. Nếu `hmac_mandatory=false`, một số thao tác dựa vào identifier/source token; tạo contact có thể tự sinh source UUID. Không coi public client API là secret server API; nếu dùng, bật HMAC và giới hạn mạng/phạm vi [S28].

**Bridge khuyến nghị [R]:** provider webhook → xác thực/lưu Tinix event → adapter chuẩn hóa → tra/tạo contact theo `(workspace, connection, external_user)` → tạo/tìm ContactInbox bằng `(inbox_id,source_id)` → tra/tạo conversation theo external thread ID → Application API `POST .../conversations/{display_id}/messages` với `message_type=incoming`, `source_id=external_message_id`, `external_created_at` nếu thích hợp → lưu link. Outbound: UI Chatwoot hoặc AI qua Application API tạo outgoing → callback event → durable Tinix outbox → adapter provider → ghi provider ID/status vào Tinix → `PATCH` Chatwoot message status khi được hỗ trợ và phù hợp [S7–S11,S16].

**Endpoint tối thiểu [C]** (mọi path dưới `/api/v1/accounts/{account_id}`; quyền tùy service user):

| Thao tác | Endpoint |
|---|---|
| Tạo API inbox / gắn agent | `POST /inboxes`, `POST /inbox_members` |
| Tạo contact và source, hoặc gắn thêm inbox | `POST /contacts` (`inbox_id`, `source_id`), `POST /contacts/{contact_id}/contact_inboxes` |
| Tìm source trong inbox | `POST /contact_inboxes/filter` (`inbox_id`, `source_id`) |
| Tạo conversation / xem bằng display ID | `POST /conversations`, `GET /conversations/{display_id}` |
| Incoming/outgoing/note/history/status | `POST/GET /conversations/{display_id}/messages`, `PATCH /conversations/{display_id}/messages/{message_id}` |
| Assignment, labels, status | `POST /conversations/{display_id}/assignments`, `/labels`, `/toggle_status` |

Source routes/controller [S16,S17]. `POST /contacts` có thể tạo ContactInbox cùng lúc; lấy ID/source thực tế từ response, không tự suy từ request. `POST /contact_inboxes/filter` trả contact associated, cần xác nhận JSON response trong POC.

**Hạn chế [C]:** `source_id` trên message có thể truyền vào builder, nhưng index không unique; việc gọi lại POST khi timeout có thể tạo tin trùng. Tinix phải dedupe trước, tra cứu quanh conversation/timestamp khi kết quả POST bất định và thử case recovery. Không có khóa idempotency POST message được xác minh trong source [S11,S16]. `sender_type=AgentBot` khi tạo outgoing đòi bot account phù hợp; service user thông thường có thể xuất hiện là human sender. Cách biểu diễn AI riêng trên timeline cần thử API bot token/agent bot và policy Tinix [S16,S29].

## Contact and Conversation Identity

**Mapping sửa lại [R]:**

```text
(workspace_id, channel_connection_id)
  -> (chatwoot_account_id, chatwoot_inbox_id, api_channel_identifier)
(workspace_id, channel_connection_id, external_user_id)
  -> (chatwoot_contact_id, chatwoot_contact_inbox_id, chatwoot_source_id)
(workspace_id, channel_connection_id, external_conversation_id OR Tinix thread key)
  -> (chatwoot_conversation_id/display_id, chatwoot_contact_inbox_id)
(workspace_id, channel_connection_id, direction, external_message_id)
  -> (chatwoot_message_id, provider_message_id, outbox_id, delivery state)
```

`external_user_id -> contact_id` **một mình không đủ**. Contact có thể merge hoặc tái dùng qua nhiều inbox; builder có thể tìm contact theo `identifier`, email hoặc phone trong cùng account trước khi tạo ContactInbox [S12,S13,S30]. Không tự gộp khác kênh chỉ bằng tên. Nếu muốn độc lập danh tính mặc định, dùng identifier namespace `provider:connection:external_user` và **không** đưa email/phone chưa xác minh vào create request; lưu các thuộc tính đó riêng, có quy trình liên kết danh tính có chủ đích [I/R].

Conversation builder trả conversation cuối của ContactInbox nếu `lock_to_single_conversation=true`; mặc định có thể tạo nhiều conversations cho cùng contact/inbox. External provider không có thread ID phải dùng Tinix conversation policy ổn định (ví dụ một thread active theo customer/connection) thay vì suy ra Chatwoot tự unique [S14]. Incoming vào resolved API conversation có thể mở lại; snoozed cũng có thể mở khi incoming. `pending` thường dùng bot workflow của Chatwoot, **không** đồng nghĩa Tinix AI mode; lưu AI state tại Tinix [S11,S15].

Đặc biệt, Application conversation routes tìm bằng `display_id` theo account, còn webhook conversation presenter dùng `display_id`; đừng gán nhầm internal database `Conversation.id` vào API path. Xác minh response create/show và mapping của tag bằng POC [S15,S17].

## Inbox Strategy

| Lựa chọn | Ưu điểm | Chi phí/giới hạn |
|---|---|---|
| A. Một API Inbox / connected account | Routing, callback secret, membership, disconnect, health, provider account identity tách rõ; source ID unique tự nhiên trong inbox | Số inbox/agent memberships và cấu hình tăng; đo thực tế khi nhiều connection |
| B. Một inbox / provider / workspace | Ít inbox | ContactInbox namespace thủ công, cùng callback/permission; khó tách credential, routing, reconnect, UI, migration |
| C. Một inbox / external thread | Cách ly mạnh | Inbox bùng nổ, lệch mô hình Chatwoot |

**[R]** Chọn A cho V1. Mỗi connected provider account có một Chatwoot API Inbox; credential thật ở Tinix, không lưu trên Chatwoot. Một workspace có thể chứa nhiều connected accounts. Khi reconnect, giữ inbox/source IDs nếu cùng external account; nếu thay external account, tạo connection/inbox mới và có migration chủ động. Basic inbox membership là boundary cho agent, **không** thay cho workspace boundary [S12,S20,S21]. Quy mô inbox tối đa được bảo đảm: **NOT VERIFIED**.

## REST API Surface

Application API v4.18.0 có các route/controller [S17]; các endpoint dưới là `/{account_id}` và conversation `{id}` dùng display ID. Tinix backend phải bọc/kiểm tra quyền trước khi frontend gọi.

| Use case native UI | Kết luận | Bằng chứng / giới hạn |
|---|---|---|
| List/status/inbox/assignee, pagination | SUPPORTED | `GET conversations`, finder mặc định 25/page; quyền theo inbox [S17,S31] |
| Search, filters | PARTIAL | Contact search riêng; conversation query trong finder tìm message text, filter route có điều kiện; khả năng search mọi trường/hiệu năng theo CE cần test [S31] |
| History, incremental pagination | SUPPORTED | `GET messages`: latest 20, `before` 20, `after` 100, range tối đa 1000 theo source [S32] |
| Send reply, private note, multipart attachments | SUPPORTED | POST messages, `message_type`, `private`, `attachments[]` [S7,S16] |
| Assignment/team, labels, status | SUPPORTED | routes, models, conversation webhook update [S17,S20] |
| Contact, custom attributes | SUPPORTED | Contact APIs/source [S13,S17] |
| Unread | PARTIAL | unread count API và conversation payload; per-user read/last-seen semantics, không coi số Chatwoot là Tinix global [S17,S25] |
| Realtime | PARTIAL | ActionCable tồn tại, nhưng frontend Tinix không nên phụ thuộc token/schema đó; relay/polling cần tự làm [S25] |
| AI vs human identity, provider delivery status | PARTIAL | Tinix metadata/state cần riêng, Chatwoot message status chỉ coarse [S11,S18] |

## Webhooks

**[D/C]** Account webhook tạo ở `/api/v1/accounts/{id}/webhooks` và chọn subscriptions. API Inbox callback cấu hình `webhook_url` riêng, **không** có subscriptions: listener gửi cùng conversation/message events của inbox tới callback. Nếu dùng cả hai với cùng URL, cùng event có hai deliveries/IDs khác nhau; dedupe theo semantic object [S4,S9].

| Event | Trigger, trường Tinix cần | Ghi chú |
|---|---|---|
| `message_created` | Message tạo; `event,id,account.id,inbox.id,conversation.id,message_type,private,sender,source_id,content,attachments` [S9,S11] | Cả incoming/outgoing/template; filter chặt |
| `message_updated` | Message cập nhật; ID/account/inbox/conversation [S9] | Webhook presenter **không chứa `status`** trong `message.webhook_data`; fetch REST nếu cần [S11] |
| `conversation_created` | Conversation mới, ID/inbox/status/meta/contact [S9,S33] | Mapping/reconcile |
| `conversation_updated` | Một số thuộc tính đổi, `changed_attributes`; team/assignee thường ở đây [S9,S15] | Không có account webhook độc lập `assignee_changed`/`team_changed` |
| `conversation_status_changed` | Status đổi [S9] | `open/resolved/pending/snoozed`; không có event `conversation_opened` hay `conversation_resolved` riêng |
| `contact_created/updated` | Contact và thay đổi; account webhook [S9] | API Inbox callback không có inbox để gửi contact events |
| `conversation_typing_on/off` | Typing và `is_private` [S9] | Ephemeral, không critical |
| `webwidget_triggered`, `inbox_created/updated` | Nguồn khác/admin [S9,S10] | Inbox events được phép trong source nhưng docs subscription list chưa đầy đủ |

**Delivery/security [C/D]:** `WebhookListener` enqueue `WebhookJob` queue `medium`; `Webhooks::Trigger` POST JSON qua SafeFetch, mặc định open/read timeout 5 giây (config `WEBHOOK_TIMEOUT`), ký `X-Chatwoot-Timestamp`, `X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "{timestamp}.{raw_body}")`, và `X-Chatwoot-Delivery` nếu có. Account webhook secret và API channel secret là **hai secret khác nhau** [S4,S9,S10]. Receiver so sánh constant-time, kiểm tra timestamp replay window, match account/inbox đã cấu hình; HTTP 2xx **chỉ sau khi ghi Tinix durable event**. Keep raw body để verify.

**Callback networking [C]:** SafeFetch từ chối URL/địa chỉ private theo mặc định; `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` bật toàn cục cho SafeFetch, không phải setting riêng của webhook [S43]. Nếu Tinix callback nằm trong Docker/Kubernetes private network, thử chính xác DNS/route/SSRF policy trong POC. Không bật tùy chọn toàn cục một cách mặc định chỉ để sửa connectivity; cân nhắc HTTPS endpoint được kiểm soát hoặc proxy có allowlist.

**Retry/ordering [C]:** `WebhookJob` không `retry_on`; trigger bắt `StandardError`, log; Sidekiq global `max_retries: 3` không biến exception đã bị nuốt thành retry. AgentBot webhook có retry riêng cho 429/500 nhưng **không áp dụng** account/API Inbox callback. Không thấy delivery log/replay API account webhook hoặc ordering guarantee trong routes/job được khảo sát: **NOT VERIFIED**, không khẳng định tuyệt đối là không thể tồn tại ở phiên bản khác. Receiver down có thể mất signal; worker down giữ job trong Redis nếu Redis bền vững nhưng không tạo sự kiện mới trong lúc service không xử lý; monitor queue. API Inbox callback failure xử lý `message_created/message_updated` có thể đánh dấu message `failed`, kể cả khi lỗi là Tinix receiver chứ không phải provider send [S10,S34]. `X-Chatwoot-Delivery` giúp dedupe từng delivery; semantic dedupe `account_id+inbox_id+event+message.id` cần cho callback/account duplicate và replay.

## Outgoing Message Flow

**[C]** Operator dùng Chatwoot UI tạo `Message` outgoing, `private=false`, sender User; `message_created` được dispatcher phát sau commit, listener enqueue callback. Tinix AI tạo outgoing qua Application API dưới bot identity khả dụng hoặc service user, gắn Tinix AI provenance trong Tinix; AI không gọi provider trực tiếp [S9,S11,S16]. Chatwoot `SendReplyJob` cho `Channel::Api` **không** gửi provider: nó chỉ đi qua email continuity service nếu feature đó được bật; đường transport chính là callback [S35].

**Single path [R]:**

1. Chatwoot tạo message; Tinix nhận callback/account event, verify + persist nhanh; return 2xx.
2. Chỉ enqueue nếu `event=message_created`, đúng account/inbox đã link, `message_type=outgoing`, `private=false`, không phải system/template ngoài capability, có ID và conversation mapping hợp lệ. `sender_type` là thuộc tính bổ sung để audit, **không** thay cho `message_type/private`.
3. Unique constraint `(chatwoot_account_id,chatwoot_message_id)` trên Tinix outbox; payload snapshot/attachment refs, correlation, AI origin, policy version. Worker claim atomically, recheck AI/human state trước khi send nếu policy yêu cầu.
4. Adapter send một lần mỗi attempt với provider idempotency key khi provider cho phép; lưu result/provider ID. Khi kết quả bất định, tra cứu provider trước khi retry nếu có API; nếu không có, trạng thái `unknown` và operator reconciliation thay vì blind resend.
5. Update status Chatwoot bằng `PATCH .../messages/{id}` (`sent/delivered/read/failed`) **chỉ cho API Inbox**, nhưng status update lại phát `message_updated`; receiver bỏ qua event này cho enqueue [S18]. Endpoint này không gắn provider ID một cách đáng tin cậy; giữ mapping ở Tinix. Không coi Chatwoot `sent` mặc định là provider accepted.

**Callback lỗi và retry UI:** API Inbox callback fail có thể mark Chatwoot `failed`, UI retry có thể enqueue `SendReplyJob`, nhưng job API channel không tái gọi provider; đồng thời webhook status/retry có thể tạo tín hiệu mới. Tinix phải cung cấp retry của **outbox** và dựa vào message ID cũ, không xây retry provider dựa vào nút retry Chatwoot trước khi POC xác minh. Đây là thay đổi quan trọng đối với UX `Failed/Retry` [S10,S18,S35].

## Loop and Duplicate Prevention

| Trường hợp | Quy tắc [R] |
|---|---|
| Tinix POST incoming tạo Chatwoot callback echo | Incoming callback chỉ dùng cập nhật/reconcile; không biến thành provider inbound lần hai |
| Human/AI cùng gửi | Versioned Tinix handoff state, kiểm tra trước commit AI và trước outbox claim; unique Chatwoot ID chống send lại **cùng message**, không tự chống hai message khác nhau |
| Callback account + inbox | Chỉ một feed cho `message_created` (ưu tiên API Inbox callback); nếu cả hai, semantic dedupe, các subscription account chỉ thêm conversation/contact events |
| Private note | Loại khi `private=true` kể cả `message_type=outgoing`; activity không qua message listener hiện tại nhưng vẫn kiểm tra |
| `message_updated` sau PATCH status | Chỉ cập nhật projection; không tạo outbound mới |
| Provider webhook echo | Provider event ID + outgoing mapping; phân loại echo qua adapter, không POST incoming lần hai |
| Crash sau provider accepted | Provider idempotency/query nếu có; nếu không, `unknown` + review; exactly-once không được chứng minh |

## Message Model

**[C]** `incoming=0`, `outgoing=1`, `activity=2`, `template=3`; `private` độc lập với type. `sent=0`, `delivered=1`, `read=2`, `failed=3`; transition service có guard forward, nhưng cho phép vào/ra `failed`. Content type gồm `text`, form/cards/sticker và loại nội bộ; file là Attachment record, không suy từ `content_type` text [S11,S18]. `content_attributes` có `in_reply_to`, `in_reply_to_external_id`, `external_created_at`, `external_error`; builder nhận `source_id`, `content_attributes`, `echo_id`. `additional_attributes` và `external_source_ids` tồn tại nhưng không phải registry ID provider ổn định/có unique [S11,S16].

**[R]** Tinix giữ riêng external account/user/thread/message ID, provider status timestamps, retry/outbox, handoff, AI origin, correlation, capabilities, provider raw metadata, reconciliation cursor, audit. Dùng `content_attributes` chỉ cho những reference Chatwoot hỗ trợ sau POC; reply-to trên từng provider phải do adapter xác nhận.

## Attachments

**[D/C]** POST message nhận `multipart/form-data` trường `attachments[]`, Active Storage hỗ trợ S3-compatible; attachment webhook có URL từ `push_event_data`. `Message` giới hạn 15 attachments; `Attachment` kiểm MIME/size 40 MB mặc định **chỉ cho WebWidget** theo source, không thể suy ra API Inbox có cùng giới hạn. Proxy, storage, provider vẫn có giới hạn riêng [S7,S36,S37]. `Attachment.file_url` trỏ Rails Active Storage route redirect; `download_url` có thể là storage URL; thời hạn chính xác tùy service/config, **NOT VERIFIED**. `external_url` tồn tại nhưng Application message builder dùng upload file/signed blob; không xác nhận remote URL ingestion được hỗ trợ trực tiếp bởi POST message [S36].

**[R] Hybrid:** Tinix giữ reference/metadata và bản durable trong object storage Tinix khi URL provider tạm thời, cần retry hoặc audit; nạp media hợp lệ vào Chatwoot Active Storage cho operator; outbound lấy bản Tinix hoặc URL Chatwoot sau khi kiểm quyền, hạn và MIME, upload qua adapter. Không public raw provider URL dài hạn; chặn SSRF khi fetch, quét/giới hạn file, auth để truy cập, retention/xóa nhất quán hai nơi. POC phải thử ảnh/file hai chiều, signed URL hết hạn, callback attachment URLs và kích thước.

## Realtime

**[C]** ActionCable listener phát `MESSAGE_CREATED/UPDATED`, `CONVERSATION_CREATED/UPDATED/STATUS_CHANGED`, `ASSIGNEE_CHANGED`, `TEAM_CHANGED`, typing, unread count change cho user/contact pubsub tokens. Webhook subscription không có `assignee_changed`/`team_changed` riêng [S25]. **[R]** Native Tinix UI gọi Tinix API và nhận Tinix WebSocket/SSE relay từ backend; backend nhận callback, phát domain event đã chuẩn hóa và reconcile. Polling với ETag/cursor là fallback khi relay down; không đưa Chatwoot pubsub token hoặc credentials ra browser. Unread counts per-user cần policy Tinix riêng; realtime chỉ là signal, refresh REST khi reconnect.

## Authentication and Security

**[C/D]** Application API dùng header `api_access_token`, token gắn User/AgentBot; quyền theo owner/role, bot token bị giới hạn endpoint. Dùng service user account-scoped, quyền tối thiểu khả thi (tạo Inbox cần admin), mã hóa/rotate token và callback secrets; không expose ra frontend [S4,S20,S29,S38]. CE không có API scope fine-grained được xác minh: **NOT VERIFIED**; cần kiểm thử least privilege theo endpoint. Account webhook HMAC secret và API Inbox callback secret khác nhau; chỉ bật URL HTTPS/private connectivity, verify raw-body HMAC/timestamp, account/inbox allowlist, giới hạn payload/rate. Không nhầm API Inbox HMAC contact identifier với webhook signature; là hai cơ chế khác nhau [S9,S28,S39].

## Multi-Tenancy

| Lựa chọn | Cách ly/quyền | Chi phí và nhận xét |
|---|---|---|
| A. Một Chatwoot Account / Tinix workspace | Account-scoped data, token và webhook tách; phù hợp native Tinix RBAC | Một deployment vẫn share DB/worker/storage; kiểm tra admin cross-account; khuyến nghị mặc định |
| B. Một Account / nhiều workspaces | Không có ranh giới account; contact identifier/email unique và admin nhìn chung dữ liệu | Không khuyến nghị cho customer độc lập |
| C. Một deployment / customer | Cách ly hạ tầng/backup/upgrade mạnh | Chi phí và vận hành nhân theo tenant; dành cho yêu cầu isolation đặc biệt |

**[I/R]** Chọn A, key Tinix luôn bắt đầu `workspace_id`, verify mapping `workspace→Chatwoot account→inbox` trên **mọi** request/callback. Một API token admin trong cùng account có thể thấy toàn bộ inbox; Tinix không dùng role Chatwoot như tenant boundary. Chuyển tenant ra deployment riêng phải có export/import mapping và object storage plan. Số account thực tế, quota/inbox count, throughput per deployment: **NOT VERIFIED** [S13,S20,S21].

## Scaling and Operations

Sidekiq queues ưu tiên `critical/high/medium/default/...`; webhook chạy `medium`, send-reply `high`; độ trễ callback khi worker backlog phải monitor riêng [S9,S25,S40]. PostgreSQL indexes trên account, inbox, conversation, source; message `source_id` index thường (không unique); pagination REST 25 conversations, 20 latest/before messages [S11,S12,S31,S32]. Redis outage ảnh hưởng Sidekiq/cache/realtime; DB outage ảnh hưởng reads/writes; object storage outage ảnh hưởng media. `rack_attack` có nhiều throttles cụ thể (widget, search, reports), **không** có cơ sở coi một rate limit chung cố định cho toàn Application API [S41].

**[R]** Monitor queue age/error, API latency, duplicate rate, outbox unknown, reconciliation lag, DB/Redis/storage, media bytes. Load test với target Tinix thật: peak messages/s, concurrent agents/WebSockets, tenant/inbox/contact counts, history depth, media throughput, callback delivery while workers restart. Không suy ra benchmark từ tài liệu RAM.

## Failure Modes

| Failure | Hành vi nguồn / recovery Tinix [R] |
|---|---|
| Chatwoot API down | Provider event đã lưu tại Tinix, retry worker có backoff; không ACK provider trước durable persist |
| Chatwoot worker/Redis down | Callback/ActionCable queue trễ hoặc mất nếu Redis mất dữ liệu; reconcile REST khi phục hồi; monitor queue |
| PostgreSQL down | Chatwoot không tạo/lấy message; Tinix giữ inbound, circuit breaker và retry |
| Tinix receiver down | Account callback có thể mất; API callback có thể mark Chatwoot message failed; REST sweep outgoing mới từ Chatwoot sau khi hồi phục [S10] |
| Duplicate/out-of-order callback | Unique outbox theo Chatwoot message ID, event log, re-fetch current REST state trước thay đổi quan trọng |
| Tinix restart | Durable event/outbox claim/lease reset an toàn; reconciliation cursor không trong memory |
| Provider success + Tinix crash | Provider idempotency/query nếu có; nếu không giữ unknown, tránh blind resend |
| Outbound accepted, callback lost | Sweep conversations/messages theo inbox và time/window; đối chiếu message ID không có outbox; giới hạn quét và watermark overlap |
| Chatwoot upgrade thất bại | Restore **DB+object storage+secrets/config** về cùng snapshot/tag; không chỉ hạ Docker tag sau migration |

REST `GET conversations` và `GET messages` đủ cho sweep giới hạn theo inbox/status/time window, nhưng không xác nhận có **global changed-message cursor**; do đó reconciliation toàn bộ ở quy mô lớn là **PARTIAL**, cần benchmark và retention window [S17,S31,S32]. Chỉ auto-send message chưa có outbox sau khi xác minh human/AI policy và tránh duplicate provider send.

## Data Ownership

| Dữ liệu | Source of truth V1 | Lưu phụ |
|---|---|---|
| Operator contact/conversation/message history, assignment, labels, notes, support status | Chatwoot | Tinix stable refs/projection, không fork DB |
| Workspace/business customer identity và verified cross-channel linkage | Tinix | Chatwoot contact attributes chỉ projection |
| Channel credentials, external account/user/thread/message IDs, capabilities | Tinix | Chatwoot inbox/source ID chỉ integration refs |
| Provider transport/delivery, incoming event log, outbox, retries, reconciliation | Tinix | Chatwoot message status projection khi xác minh |
| AI state/policy/provenance/handoff, correlation/audit | Tinix | Chatwoot UI có thể hiện note/attributes thích hợp nhưng không authoritative |
| Media | Hybrid theo retention policy | Storage references hai bên, cleanup có kiểm soát |

## Replaceability / Anti-Lock-In

**[I/R]** `ChannelAdapter → UnifiedEvent/Message → ConversationProvider` là boundary hợp lý nhưng **chưa đủ nếu chỉ CRUD**. Contract cần định danh ổn định, pagination/cursor, actor origin, visibility/private note, status projection, assignment, capability, realtime subscription/reconciliation, lỗi/idempotency, media lifecycle. Đặt adapter chống lệ thuộc Chatwoot chuyển: `Inbox → ChannelConnection`, `ContactInbox/source_id → ChannelIdentity`, `display_id → ConversationRef`, enum message/status → Tinix domain enums, `assignee/team/labels/custom_attributes → operator assignment/tags/metadata` có version. Tinix frontend/AI chỉ dùng domain DTO. Migration tương lai cần export full history, media, links, unread/assignment và cutover có dual reconciliation; thay class provider **không tự động** migrate dữ liệu.

## Native Tinix Inbox Feasibility

**[I]** V1 native UI có thể làm với Application APIs cho các thao tác cơ bản trong bảng REST ở trên; Chatwoot UI phù hợp Phase đầu cho operator validation. Partial: cross-field search, unread semantics, reliable provider delivery, AI identity, comprehensive realtime và retries. Tinix backend làm facade, policy, outbox/status, realtime relay. UI “Sent” phải dựa vào Tinix provider result; private note rõ ràng; nút retry phải gọi Tinix outbox chứ không dựa vào Chatwoot API Inbox `SendReplyJob` [S10,S18,S25,S31,S35].

## Deployment and Upgrade Strategy

**[R]** Pin **exact release + CE image digest** (xác nhận image `v4.18.0-ce` tồn tại); không dùng `latest`, không auto-follow minor. Theo security releases có lịch bảo trì: đọc changelog/migrations, upgrade staging cùng config và dữ liệu đại diện, chạy POC contract, kiểm webhook HMAC/outbound/status, backup DB + Active Storage + secrets/Redis snapshot cần thiết, ngừng writes/có maintenance window cho migration, `rails db:chatwoot_prepare`, smoke test web/worker/ActionCable rồi rollout production. Docker docs khuyên đi qua intermediate tags khi cũ [S1,S24]. Migrations **không được chứng minh backward-compatible**; rollback bằng snapshot nhất quán, không giả định `down` migration an toàn. Giữ Tinix incoming queue trong outage để replay sau restore.

## Licensing Notes

Core ngoài `enterprise/` là MIT Expat; enterprise directory dùng `enterprise/LICENSE`, không đưa mã/thành phần enterprise vào bản CE Tinix [S19]. Official self-hosted FAQ nói CE cho phép use/modify/resell derivatives, đồng thời nêu các use case cạnh tranh Chatwoot Business họ không khuyến khích; đây là tuyên bố của nhà cung cấp, **không thay đổi kết luận từ text license** [S42]. Tích hợp CE thông qua API không đòi fork, thuận cho nâng cấp. **Requires legal review** nếu Tinix phân phối một bản sửa đổi Chatwoot, gói enterprise code, hoặc thương mại hóa dịch vụ có tranh luận về điều khoản/nhãn hiệu; đây không phải tư vấn pháp lý.

## Architecture Validation Matrix

| Decision trong PLAN | Status | Evidence | Required change |
|---|---|---|---|
| 1. CE làm ConversationProvider V1 | VALIDATED WITH LIMITATIONS | Core + self-hosted feature table [S5,S6,S17] | POC và RBAC/scale tests |
| 2. Tinix sở hữu Channel Gateway | VALIDATED | API Inbox callback/REST [S2,S9] | Giữ credentials/IDs tại Tinix |
| 3. Không fork sâu Chatwoot | VALIDATED | Public supported APIs [S6–S8] | Chỉ patch nhỏ nếu có bằng chứng |
| 4. API Channel cho custom providers | VALIDATED WITH LIMITATIONS | API Inbox + callback [S2,S6,S9] | Kiểm provider capability riêng |
| 5. Inbox-per-connected-account | VALIDATED WITH LIMITATIONS | Source uniqueness/member scoping [S12,S21] | Load test inbox count |
| 6. Single outbound path | VALIDATED WITH LIMITATIONS | Outgoing event, no native API provider send [S9,S35] | Strict filtering, state/idempotency |
| 7. Chatwoot webhook + Tinix outbox | CHANGE RECOMMENDED | No account/API callback retry guarantee; API callback failure marks failed [S10] | Durable ACK, sweep, choose feed |
| 8. Tinix owns idempotency | VALIDATED | Message source_id nonunique [S11] | DB constraints + recovery window |
| 9. Native UI chỉ gọi Tinix backend | VALIDATED | API + security boundary [S17,S38] | Facade/relay |
| 10. Replace later with Tinix provider | VALIDATED WITH LIMITATIONS | Domain seam possible [S12–S17] | Contract + migration export |
| 11. n8n ngoài critical path | VALIDATED | No Chatwoot dependency requiring n8n [S6–S10] | Không đổi |

## Recommended Changes to PLAN_TinixInbox.md

### CHANGE-001 — CRITICAL
**Current plan:** “Chatwoot callback/webhook → Tinix Outbox” và “verify signature/secret theo cơ chế Chatwoot”. **Finding:** API Inbox callback và account webhook là hai feeds/secrets; account/API job không retry riêng; lỗi API callback có thể mark message `failed`; SafeFetch chặn private URL mặc định [S9,S10,S43]. **Recommended change:** quy định feed message ưu tiên API Inbox callback; account webhook chỉ nhận contact/conversation events hoặc semantic dedupe nếu nhận cả hai. Verify đúng secret và HMAC/timestamp; ACK 2xx sau durable receipt; REST reconciliation bắt buộc. POC callback endpoint trong topology deploy thật. **Reason:** không để double-send/mất signal/trạng thái lỗi sai.

### CHANGE-002 — HIGH
**Current plan:** mapping `external_user_id → chatwoot_contact_id`, `external_user_id + inbox → source_id`. **Finding:** source unique `(inbox_id,source_id)`; contact identifier/email/phone unique per account, builder có thể merge; conversation ID API là display ID [S12–S17,S30]. **Recommended change:** mapping composite như mục Identity, thêm `chatwoot_account_id`, `contact_inbox_id`, `api_channel_identifier`, namespace contact identifier, lưu internal/display refs rõ. **Reason:** chống cross-channel/tenant collision và mapping sai.

### CHANGE-003 — HIGH
**Current plan:** Chatwoot outgoing → callback → provider, delivery UI `sent/delivered/read`. **Finding:** `status=sent` default trước provider; status update làm `message_updated`, webhook payload không có status; Chatwoot API Inbox retry UI không gọi provider [S10,S11,S18,S35]. **Recommended change:** Tinix delivery state authoritative, REST fetch khi status signal, Tinix outbox retry/unknown UX. **Reason:** tránh báo sai trạng thái/gửi lặp.

### CHANGE-004 — HIGH
**Current plan:** ignore private/system/echo. **Finding:** private outgoing vẫn qua webhook; incoming do Tinix tạo cũng echo; message webhook còn template [S9,S11]. **Recommended change:** explicit predicate theo event/account/inbox/type/private/message ID, outbound unique DB constraint, loop classification per provider. **Reason:** private note và AI/human không gửi sai.

### CHANGE-005 — MEDIUM
**Current plan:** một conversation mapping theo external ID. **Finding:** nhiều conversations/ContactInbox trừ khi lock single; incoming có thể reopen [S14,S15]. **Recommended change:** quyết định `lock_to_single_conversation` theo provider, thread key khi provider không có conversation ID, policy reopen/new thread và preserve historical links. **Reason:** tránh nối thread sai.

### CHANGE-006 — MEDIUM
**Current plan:** hỗ trợ image/file và remote provider URL. **Finding:** API message hỗ trợ multipart/Active Storage, không xác nhận POST tự fetch remote URL; size MIME WebWidget khác API [S7,S36]. **Recommended change:** hybrid storage, explicit download/upload path, retention/SSRF/limits POC. **Reason:** media tạm thời và retry.

### CHANGE-007 — MEDIUM
**Current plan:** native UI search/unread/realtime kỳ vọng rộng. **Finding:** REST tìm kiếm/đếm và ActionCable có giới hạn/semantics riêng [S25,S31,S32]. **Recommended change:** ghi capability `PARTIAL`, Tinix facade + relay/poll fallback, search acceptance theo trường đã xác minh. **Reason:** UI không hứa chức năng chưa có.

### CHANGE-008 — MEDIUM
**Current plan:** CE + basic permissions. **Finding:** custom RBAC/SSO/audit không ở CE theo self-hosted table [S5]. **Recommended change:** ghi rõ basic agent/admin/inbox membership khác paid custom roles; Tinix RBAC/audit độc lập, POC account isolation. **Reason:** tránh phụ thuộc Enterprise.

### CHANGE-009 — MEDIUM
**Current plan:** version/deployment chưa pin. **Finding:** v4.18.0 latest; Docker guide dùng `latest` và template `develop`, upgrade chạy migrations [S1,S24]. **Recommended change:** exact CE tag/digest, synchronized templates, staging contract gate, consistent restore snapshot. **Reason:** tránh drift và rollback không an toàn.

Không sửa plan trong research task; chủ dự án review/duyệt các change trước khi triển khai phần phụ thuộc.

## Risk Register

| ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R01 | API/payload đổi sau upgrade | Trung bình | Cao | Pin exact version, contract POC staging |
| R02 | CE/Enterprise boundary | Thấp/vừa | Cao | Feature matrix, CE-only image, smoke test |
| R03 | Webhook lost/receiver down | Trung bình | Cao | Durable receipt, REST sweep, monitoring |
| R04 | Duplicate outbound/handoff race | Trung bình | Rất cao | Unique outbox, versioned state, provider idempotency |
| R05 | Chatwoot concepts leak/lock-in | Trung bình | Trung bình | Domain DTO, mapping, export rehearsal |
| R06 | Scale: workers/DB/inbox count | Chưa biết | Cao | Load test theo số liệu Tinix |
| R07 | Attachment URL/storage expiry | Trung bình | Cao | Hybrid storage, retention, access controls |
| R08 | Multi-tenant mapping/access | Trung bình | Rất cao | Account/workspace boundary, auth tests |
| R09 | Provider/ContactInbox ID collisions | Trung bình | Cao | Composite key, namespace, no blind merge |
| R10 | Upgrade migrations/rollback | Trung bình | Cao | Staging, DB+files snapshot, restore drill |
| R11 | Realtime disconnect/unread drift | Trung bình | Trung bình | Relay + REST refresh/poll fallback |
| R12 | Callback failure marks Chatwoot `failed` | Trung bình | Trung bình/cao | ACK durable, reconcile and separate delivery state |
| R13 | SafeFetch chặn private callback URL | Trung bình | Cao | POC topology, controlled HTTPS/allowlist [S43] |

## Open Questions

- Tinix repo thực tế, stack, queue, workspace auth, encrypted storage, deployment và test tools chưa được cung cấp.
- Số tenants, connected accounts, peak messages/s, concurrent agents, retention, SLA, media mix và kích thước chưa biết.
- Khả năng/provider-specific external conversation/message ID, idempotent send, lookup/reconcile, receipts, attachment URL expiry, API scopes/market approvals chưa thuộc phạm vi Chatwoot research.
- CE image `v4.18.0-ce` và digest cụ thể, webhook behavior trong deploy thực tế, SafeFetch response errors, delivery logs/replay UI, account/API callback double delivery, Chatwoot status after provider update cần POC.
- AI identity qua AgentBot Application token vs User token, human takeover race, native UI unread/search performance cần test với phiên bản và role thực.
- Tinix cần active conversation per customer hay preserve multiple external threads? Chốt theo từng provider.
- RPO/RTO, chính sách backup Redis/Active Storage và xóa dữ liệu khách hàng cần sản phẩm/vận hành quyết định.

## Recommended POC

**Phase 0, CE `v4.18.0` riêng trên local/staging, không làm trong research.** Tạo account và hai API inbox; service user + human agent; callback receiver ký HMAC và persist raw event. Một fake provider adapter ghi send count, không gửi khách hàng thật.

| Test | Acceptance criteria |
|---|---|
| 1. Start, create Account/API Inbox | CE image/tag pin; Rails/worker/PG/Redis/Active Storage healthy; inbox identifier/secret lưu đúng |
| 2. Contact/ContactInbox | create/find source; same external ID ở hai inbox không collision; identifier/email collision case được ghi rõ |
| 3. Conversation | create/find, lock single on/off, `display_id` mapping, status reopen/resolved/pending/snoozed |
| 4. Incoming | một provider event tạo một Chatwoot message, duplicate event không tạo hai; callback incoming không outbound |
| 5. Human outgoing | một UI reply tạo đúng một outbox/send; account/callback duplicate/reorder không gửi hai |
| 6. Private/activity/template | note không ra provider; activity không ra provider; template policy explicit |
| 7. AI | một AI reply cùng path, provenance rõ; takeover trước commit/send chặn reply AI thứ hai |
| 8. Callback failure/restart | receiver 500/timeout, inspect Chatwoot `failed`; Tinix recovery sweep tìm message; Chatwoot/Tinix restart giữ mapping; test callback route private/public với SafeFetch policy [S43] |
| 9. Attachment | incoming image/file upload, outgoing callback URL/file fetch/upload, size/MIME/expiry test |
| 10. Status/assignment/security | role basic, cross-account denial, status PATCH gây message_updated không resend; HMAC giả/replay bị chặn |

**Gate:** lưu request/response sample đã redacted, số lần fake provider send, DB unique violations, event IDs, worker logs; mọi case trên pass hoặc ghi blocker cụ thể. Cần thử retry/backoff của callback thật (không suy từ Sidekiq default), account/API callback, và `message.id` ổn định. Sau POC mới phê duyệt changes và Phase 1.

## Final Recommendation

Giữ Chatwoot CE làm ConversationProvider V1 và một API Inbox cho mỗi connected provider account. Dùng Application API server-to-server, API Inbox callback đã ký để nhận message, account webhook chọn conversation/contact; Tinix sở hữu durable event, outbox, provider delivery, AI state và reconciliation. Giữ Chatwoot UI cho validation ban đầu, native UI qua Tinix backend. **Không bắt đầu Phase 1** cho đến khi CHANGE-001–004 được chấp thuận và POC outbound/private note/downtime/mapping qua gate. Không cần direct Chatwoot PostgreSQL access cho các use case đã nêu; production code chỉ dùng supported API/webhooks [S6–S10,S17]. Không cần deep fork; nếu API thiếu chức năng bắt buộc, tài liệu hóa patch nhỏ và đánh giá upstream trước.

## Sources

Nguồn mã dưới đây là permalink của **commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d`**, không phải `master` di động.

- **[S1]** [Official releases, v4.18.0](https://github.com/chatwoot/chatwoot/releases/tag/v4.18.0).
- **[S2]** [Official API Inbox guide](https://www.chatwoot.com/hc/user-guide/articles/1677839703-how-to-create-an-api-channel-inbox).
- **[S3]** [Official webhook guide](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks).
- **[S4]** [Webhook create API and signature](https://developers.chatwoot.com/api-reference/webhooks/add-a-webhook).
- **[S5]** [Self-hosted plan comparison](https://www.chatwoot.com/pricing/self-hosted-plans).
- **[S6]** [Create inbox API](https://developers.chatwoot.com/api-reference/inboxes/create-an-inbox); [Channel::Api model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/channel/api.rb).
- **[S7]** [Create application message API](https://developers.chatwoot.com/api-reference/messages/create-new-message).
- **[S8]** [Create conversation API](https://developers.chatwoot.com/api-reference/conversations/create-new-conversation); [create contact API](https://developers.chatwoot.com/api-reference/contacts-api/create-a-contact).
- **[S9]** [WebhookListener](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/listeners/webhook_listener.rb).
- **[S10]** [WebhookJob](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/jobs/webhook_job.rb); [Webhooks::Trigger](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/lib/webhooks/trigger.rb).
- **[S11]** [Message model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/message.rb); [MessageFilterHelpers](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/concerns/message_filter_helpers.rb).
- **[S12]** [ContactInbox model and unique index](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/contact_inbox.rb).
- **[S13]** [Contact model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/contact.rb).
- **[S14]** [ConversationBuilder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/builders/conversation_builder.rb).
- **[S15]** [Conversation model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/conversation.rb).
- **[S16]** [Messages::MessageBuilder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/builders/messages/message_builder.rb); [message controller](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/api/v1/accounts/conversations/messages_controller.rb).
- **[S17]** [Routes](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/config/routes.rb); [conversation controller](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/api/v1/accounts/conversations_controller.rb).
- **[S18]** [StatusUpdateService](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/services/messages/status_update_service.rb).
- **[S19]** [Core LICENSE](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/LICENSE); [enterprise/LICENSE](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/enterprise/LICENSE).
- **[S20]** [Account model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/account.rb); [Inbox policy](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/policies/inbox_policy.rb).
- **[S21]** [Conversation permission filter](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/services/conversations/permission_filter_service.rb).
- **[S22]** [Ruby version](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/.ruby-version); [Gemfile.lock](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/Gemfile.lock); [package.json](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/package.json).
- **[S23]** [Official system requirements](https://developers.chatwoot.com/self-hosted/deployment/requirements).
- **[S24]** [Official Docker deployment/upgrade and CE tags](https://developers.chatwoot.com/self-hosted/deployment/docker).
- **[S25]** [ActionCableListener](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/listeners/action_cable_listener.rb).
- **[S26]** [Official production architecture](https://developers.chatwoot.com/self-hosted/deployment/architecture).
- **[S27]** [Release notes enterprise audit hardening](https://github.com/chatwoot/chatwoot/releases/tag/v4.18.0).
- **[S28]** [Public contacts API controller](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/public/api/v1/inboxes/contacts_controller.rb); [public messages controller](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/public/api/v1/inboxes/messages_controller.rb).
- **[S29]** [AccessTokenAuthHelper](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/concerns/access_token_auth_helper.rb).
- **[S30]** [ContactInboxWithContactBuilder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/builders/contact_inbox_with_contact_builder.rb); [ContactInboxBuilder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/builders/contact_inbox_builder.rb).
- **[S31]** [ConversationFinder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/finders/conversation_finder.rb).
- **[S32]** [MessageFinder](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/finders/message_finder.rb).
- **[S33]** [Conversation event presenter](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/presenters/conversations/event_data_presenter.rb).
- **[S34]** [Sidekiq configuration](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/config/sidekiq.yml).
- **[S35]** [SendReplyJob](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/jobs/send_reply_job.rb); [API channel email continuity](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/services/messages/send_email_notification_service.rb).
- **[S36]** [Attachment model](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/attachment.rb).
- **[S37]** [Active Storage configuration](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/config/storage.yml).
- **[S38]** [API base controller](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/controllers/api/base_controller.rb).
- **[S39]** [WebhookSecretable](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/app/models/concerns/webhook_secretable.rb).
- **[S40]** [Sidekiq queues](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/config/sidekiq.yml).
- **[S41]** [Rack Attack throttles](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/config/initializers/rack_attack.rb).
- **[S42]** [Official self-hosted FAQ, licensing/SaaS](https://developers.chatwoot.com/self-hosted/faq/).

- **[S43]** [SafeFetch default network policy](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/lib/safe_fetch.rb); [Fetcher](https://github.com/chatwoot/chatwoot/blob/9f920b549c14491a4e587687a3eed5d21c6ccc7d/lib/safe_fetch/fetcher.rb).
