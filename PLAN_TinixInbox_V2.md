# PLAN_TinixInbox.md — V2

> Kế hoạch triển khai **Tinix Inbox** cho Codex  
> Trạng thái: **V2 / Ready for Phase 0 audit + Chatwoot POC / Phase 1 gated**  
> Kiến trúc mục tiêu: **Tinix Channel Gateway + Chatwoot Community v4.18.0 ConversationProvider + Tinix AI Agent + n8n tùy chọn**  
> Ngày cập nhật V2: 2026-09-28  
> Cơ sở cập nhật: `RESEARCH_Chatwoot.md` — Chatwoot CE v4.18.0, tag/commit đã research: `v4.18.0` / `9f920b549c14491a4e587687a3eed5d21c6ccc7d`

---

## V2 Change Log

V2 hấp thụ các finding chính từ `RESEARCH_Chatwoot.md`.

Đã áp dụng:

```text
CHANGE-001 CRITICAL
API Inbox callback vs account webhook,
durable ACK, REST reconciliation, SafeFetch POC

CHANGE-002 HIGH
Composite ContactInbox/source/account/inbox/conversation mapping

CHANGE-003 HIGH
Tinix-authoritative provider delivery state

CHANGE-004 HIGH
Strict outbound predicate, private-note/incoming/template protection

CHANGE-005 MEDIUM
Provider-specific conversation/thread policy

CHANGE-006 MEDIUM
Hybrid attachment storage and explicit upload/download path

CHANGE-007 MEDIUM
Native UI search/unread/realtime capability marked partial until verified

CHANGE-008 MEDIUM
Tinix-owned RBAC/audit; no Enterprise dependency for MVP

CHANGE-009 MEDIUM
Exact Chatwoot version/image pin + staged upgrade/restore strategy
```

V2 không coi `RESEARCH_Chatwoot.md` là implementation plan; research là technical evidence, còn file này là approved implementation roadmap.

Phase 1 bị chặn cho đến khi Phase 0 POC xác minh các behavior runtime quan trọng.

## 1. Mục tiêu

Xây dựng **Tinix Inbox** thành hệ thống quản lý hội thoại đa kênh, ưu tiên thị trường Việt Nam, có khả năng:

- Nhận và gửi tin nhắn từ nhiều nền tảng.
- Chuẩn hóa mọi kênh về một message model thống nhất.
- Quản lý contact, conversation, message history, assignment và human takeover.
- Cho phép **Tinix AI Agent** tự động trả lời theo policy.
- Cho phép nhân viên tiếp quản hội thoại mà không gây double-reply.
- Có kiến trúc adapter để bổ sung/bỏ kênh mà không sửa core.
- Không phụ thuộc Pancake làm hạ tầng bắt buộc.
- Không phụ thuộc sâu vào Chatwoot để có thể thay Chatwoot trong tương lai.
- Có đường mở rộng sang CRM, order tools, workflow và automation.
- Đảm bảo retry, idempotency, observability, security và tenant isolation ngay từ kiến trúc nền.

MVP không nhằm viết lại toàn bộ Chatwoot. Chatwoot được dùng như **conversation infrastructure** trong giai đoạn đầu; Tinix sở hữu channel integration, AI và business logic.

---

## 2. Quyết định kiến trúc đã chốt — V2

### 2.1. Kết luận sau Chatwoot research

`RESEARCH_Chatwoot.md` xác nhận kiến trúc Tinix Inbox dùng **Chatwoot Community Edition làm ConversationProvider V1** là khả thi, nhưng production readiness phải đi qua Phase 0 POC.

Các quyết định giữ nguyên:

- Tinix sở hữu Channel Gateway và provider credentials.
- Chatwoot CE làm ConversationProvider V1.
- Tinix sở hữu AI Agent, AI/human handoff, transport delivery state, outbox, idempotency và reconciliation.
- Không fork sâu Chatwoot.
- n8n không nằm trên critical messaging path.
- Frontend Tinix không gọi trực tiếp Chatwoot hoặc provider API.
- Chatwoot phải có thể được thay bằng `TinixConversationProvider` về sau.

Các điều chỉnh V2 bắt buộc:

1. Phân biệt **API Inbox callback** và **account webhook**.
2. API Inbox callback là feed ưu tiên cho message events; account webhook dùng cho contact/conversation events hoặc phải semantic-deduplicate nếu cùng nhận message events.
3. Không coi callback/webhook Chatwoot là durable queue.
4. Tinix phải durable-persist callback trước khi trả `2xx`, rồi xử lý async.
5. Tinix phải có REST reconciliation vì callback có thể mất.
6. Outbound chỉ enqueue khi predicate chặt:
   - `event == message_created`;
   - đúng Chatwoot account/inbox;
   - `message_type == outgoing`;
   - `private == false`;
   - message ID chưa xử lý;
   - loại message được policy/capability cho phép.
7. `Chatwoot message.status` không phải source of truth cho provider delivery.
8. Tinix giữ delivery state authoritative.
9. Mapping phải bao gồm Account + Inbox + ContactInbox/source + Conversation reference + Message/outbox/provider IDs.
10. V1 pin exact Chatwoot release/image digest sau khi POC xác minh.

### 2.2. Kiến trúc cấp cao

```text
 Facebook / Instagram
 Zalo OA
 TikTok Shop
 Shopee
 WhatsApp / Telegram (future)
          │
          ▼
┌──────────────────────────────┐
│    Tinix Channel Gateway     │
│                              │
│ MetaAdapter                  │
│ ZaloAdapter                  │
│ TikTokShopAdapter            │
│ ShopeeAdapter                │
└──────────────┬───────────────┘
               │ provider events
               ▼
┌──────────────────────────────┐
│ Tinix Durable Event Layer    │
│ verify + persist + dedupe    │
│ retry + correlation          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ ConversationProvider         │
│                              │
│ V1: Chatwoot CE v4.18.0      │
│ Future: Tinix Native         │
└──────────────┬───────────────┘
               │
      ┌────────┴─────────┐
      │                  │
      ▼                  ▼
┌──────────────┐   ┌───────────────────┐
│ Tinix Agent  │   │ Tinix Outbound    │
│ Runtime      │   │ Outbox + Delivery │
└──────┬───────┘   └─────────┬─────────┘
       │                     │
       ▼                     ▼
 n8n / Tools           ChannelAdapter.send()
   optional                  │
                              ▼
                           Provider
```

### 2.3. Chatwoot event topology

```text
Chatwoot API Inbox callback
        │
        │ message_created / message_updated
        ▼
Tinix Chatwoot Callback Receiver
        │
        ├─ verify HMAC + timestamp
        ├─ validate account/inbox allowlist
        ├─ persist durable event
        └─ ACK 2xx
             │
             ▼
       async processing
             │
             ├─ incoming echo → reconcile only
             ├─ outgoing public → outbox
             ├─ private note → never provider send
             ├─ message_updated → projection/reconcile only
             └─ template/activity → explicit policy
```

Account webhook:

```text
Chatwoot account webhook
        │
        ├─ contact events
        ├─ conversation events
        └─ optional message events only if required
                 │
                 ▼
      semantic dedupe if overlap
```

### 2.4. Ownership boundary

**Tinix authoritative cho:**

- workspace/tenant identity;
- channel credentials và connection lifecycle;
- provider/external IDs;
- ChannelAdapter;
- normalized events/messages;
- callback durable receipt;
- idempotency;
- outbox;
- provider delivery state;
- retries;
- reconciliation;
- AI policies;
- AI/human routing;
- AI provenance;
- handoff state;
- provider capabilities;
- business customer identity/cross-channel linkage;
- correlation/audit;
- native Tinix UI facade;
- business tool integrations.

**Chatwoot authoritative ở V1 cho operator/support state:**

- Contact;
- ContactInbox;
- Conversation;
- message history used by operators;
- Inbox;
- assignment/team;
- labels;
- private notes;
- basic conversation support status;
- initial human operator UI.

**Không coi Chatwoot authoritative cho:**

- provider send acceptance;
- provider delivered/read;
- Tinix retry state;
- AI/human policy state;
- external provider message identity;
- Tinix tenant authorization;
- cross-channel customer identity.

### 2.5. ConversationProvider anti-corruption layer

Không để Tinix domain phụ thuộc trực tiếp vào Chatwoot nouns như `ContactInbox`, `display_id`, `message_type`, `source_id`.

Logical contract phải map sang Tinix domain:

```ts
interface ConversationProvider {
  ensureIdentity(input: EnsureChannelIdentityInput): Promise<ChannelIdentityRef>;
  ensureConversation(input: EnsureConversationInput): Promise<ConversationRef>;

  createIncomingMessage(
    input: IncomingConversationMessage
  ): Promise<MessageRef>;

  createOutgoingMessage(
    input: OutgoingConversationMessage
  ): Promise<MessageRef>;

  listMessages(
    input: ListMessagesInput
  ): Promise<MessagePage>;

  updateSupportState(
    input: UpdateSupportStateInput
  ): Promise<void>;

  assignConversation(
    input: AssignConversationInput
  ): Promise<void>;

  addPrivateNote?(
    input: PrivateNoteInput
  ): Promise<MessageRef>;

  reconcileConversation?(
    input: ReconcileConversationInput
  ): Promise<ReconcileResult>;
}
```

Không cần implement mọi method ngay Phase 1 nếu chưa dùng, nhưng domain model phải chừa đúng boundary.

### 2.6. Chatwoot replaceability

Implementation V1:

```text
ChatwootConversationProvider
```

Future:

```text
TinixConversationProvider
```

Không được để:

```text
MetaAdapter -> Chatwoot trực tiếp
ZaloAdapter -> Chatwoot trực tiếp
AI Agent -> Chatwoot implementation details
Frontend -> Chatwoot trực tiếp
```

### 2.7. n8n boundary

n8n chỉ dùng cho:

```text
CRM
ERP
orders
email
internal notification
business workflows
```

Không dùng n8n làm transport bắt buộc cho plain messaging.

---

## 3. Nguyên tắc triển khai bắt buộc cho Codex

1. **Audit repository trước khi code.**
2. Dùng framework, database, logging, config, test runner và conventions đã có trong Tinix; không đưa framework mới vào nếu không có lý do kỹ thuật rõ ràng.
3. Không thay đổi code ngoài phạm vi Tinix Inbox nếu không cần thiết.
4. Không ghi secret/token thật vào source, fixture, test snapshot hoặc log.
5. Mọi migration phải backward-compatible nếu có thể.
6. Mọi webhook handler phải:
   - verify authenticity;
   - chống replay khi provider hỗ trợ;
   - persist/deduplicate event;
   - trả response nhanh;
   - xử lý nghiệp vụ async.
7. Mọi outbound message phải idempotent.
8. Không để AI và human gửi trùng một message.
9. Không để n8n trở thành message transport chính.
10. Không gọi provider API trực tiếp từ UI.
11. Không expose Chatwoot token hoặc provider token ra frontend.
12. Mọi provider-specific logic phải nằm sau `ChannelAdapter`.
13. Mọi Chatwoot-specific logic phải nằm sau `ConversationProvider`.
14. Feature phải có feature flag cho đến khi E2E pass.
15. Sau mỗi phase: test, build, ghi checkpoint và chỉ tiếp tục khi acceptance criteria pass.
16. Nếu capability của Shopee/TikTok/Zalo khác tài liệu hoặc phụ thuộc approval, Codex phải ghi rõ `BLOCKED_BY_PROVIDER` thay vì giả lập như đã hỗ trợ production.


### 3.1. Research dependency

Cho mọi task phụ thuộc Chatwoot:

- đọc `RESEARCH_Chatwoot.md`;
- không dùng Chatwoot behavior chưa verify như fact production;
- nếu POC mâu thuẫn research/plan, dừng affected implementation và report;
- không tự sửa architecture silently.

### 3.2. Source-of-truth priority cho implementation

```text
User-approved task/decision
→ AGENTS.md
→ PLAN_TinixInbox.md V2
→ verified runtime POC result
→ RESEARCH_Chatwoot.md evidence
→ repo conventions
```

Nếu runtime POC phát hiện behavior khác research v4.18.0, ghi exact environment/version và tạo plan change request trước production implementation.

---

## 4. Phase 0 — Repository Audit + Chatwoot Architecture POC

### 4.1. Mục tiêu

Phase 0 không phải production implementation.

Mục tiêu là:

1. audit repo Tinix thật;
2. map kiến trúc V2 vào conventions hiện có;
3. chạy Chatwoot CE POC thực tế;
4. khóa các behavior mà research chỉ xác minh bằng docs/source;
5. resolve toàn bộ architecture gate trước Phase 1.

### 4.2. Tài liệu bắt buộc đọc trước Phase 0

Codex phải đọc toàn bộ:

```text
AGENTS.md
PLAN_TinixInbox.md
RESEARCH_Chatwoot.md
UI_UX.md nếu task chạm UI
```

Nếu `RESEARCH_Chatwoot.md` và plan mâu thuẫn:

- không tự chọn interpretation;
- báo rõ conflict;
- ưu tiên cập nhật plan/decision trước khi code production;
- không biến assumption thành behavior production.

### 4.3. Repository audit bắt buộc

Xác định:

- App desktop/web/hybrid/multi-process.
- Backend runtime.
- Frontend framework.
- Database và ORM/query layer.
- Migration system.
- Existing HTTP server/routes/controllers.
- Existing background job/queue system.
- Existing event bus/outbox.
- Existing provider/plugin architecture.
- Existing AI Agent/runtime abstraction.
- Existing secret/config mechanism.
- Existing logger/error model.
- Existing feature flags.
- Existing auth/workspace/tenant model.
- Existing UI component/design-token system.
- Existing test framework.
- Build/restart/deploy commands.
- Existing retry/idempotency patterns.
- Existing object storage/media abstraction.
- Existing realtime/WebSocket/SSE mechanism.

Search tối thiểu:

```text
agent
provider
webhook
queue
job
worker
outbox
retry
oauth
secret
credential
workspace
tenant
account
contact
conversation
chat
message
notification
event
plugin
integration
realtime
websocket
storage
attachment
feature flag
```

### 4.4. Chatwoot POC baseline

POC dùng:

```text
Chatwoot Community Edition v4.18.0
```

Pin release tag và xác minh CE image/tag/digest thực tế trước khi ghi vào production config.

POC có:

- 1 Chatwoot Account;
- ít nhất 2 API Inboxes;
- 1 service user;
- 1 human agent;
- callback receiver Tinix POC;
- fake ChannelAdapter ghi nhận số lần send;
- PostgreSQL;
- Redis;
- Sidekiq worker;
- Active Storage basic setup.

Không dùng khách hàng/provider thật cho outbound POC.

### 4.5. POC test matrix bắt buộc

#### POC-01 — API Inbox bootstrap

Xác minh:

- create Account/API Inbox;
- `channel.identifier`;
- numeric inbox ID;
- callback secret;
- service token;
- inbox membership;
- web/worker/DB/Redis healthy.

#### POC-02 — Contact / ContactInbox identity

Test:

- create contact;
- create/find ContactInbox;
- same external user ID ở hai inbox không collision;
- contact `identifier` namespace;
- không auto-merge qua email/phone chưa verified;
- response IDs được lấy từ API thay vì suy từ request.

#### POC-03 — Conversation identity

Test:

- create/find conversation;
- API reference thực tế dùng `display_id`;
- preserve Chatwoot reference rõ ràng;
- `lock_to_single_conversation` on/off;
- open/resolved/pending/snoozed;
- incoming reopen behavior.

#### POC-04 — Incoming message

Fake provider event:

```text
Provider
→ Tinix durable event
→ Chatwoot incoming
```

Acceptance:

- exactly one Chatwoot message;
- duplicate provider event không tạo message thứ hai;
- Chatwoot callback echo incoming không tạo provider outbound.

#### POC-05 — Human outgoing

Human reply trong Chatwoot:

```text
Chatwoot
→ API Inbox callback
→ Tinix durable receipt
→ outbox
→ fake adapter
```

Acceptance:

- fake adapter send count = 1;
- duplicate callback/account event không làm send count > 1.

#### POC-06 — Private note / activity / template

Xác minh:

- outgoing private note không vào outbox;
- incoming không vào outbox;
- activity không vào outbox;
- template có explicit policy;
- predicate outbound được test unit + integration.

#### POC-07 — AI outgoing / handoff

AI tạo outgoing qua ConversationProvider.

Test:

- cùng outbound path với human;
- AI provenance ở Tinix;
- human takeover trước AI commit/send chặn AI send;
- không có direct provider-send path từ AI.

#### POC-08 — Callback failure + reconciliation

Mô phỏng:

```text
Tinix callback 500
Tinix callback timeout
Tinix receiver down
Tinix restart
Chatwoot restart
```

Xác minh:

- Chatwoot message state khi callback fail;
- callback có/không retry thực tế;
- REST reconciliation tìm outgoing thiếu outbox;
- mapping survive restart;
- không blind resend khi provider result không chắc chắn.

#### POC-09 — SafeFetch/network topology

Test callback URL theo topology deploy dự kiến.

Xác minh:

- private Docker/Kubernetes DNS/IP có bị SafeFetch chặn không;
- HMAC vẫn đúng qua reverse proxy;
- HTTPS/public controlled endpoint nếu cần;
- không bật allow-private-network toàn cục chỉ để workaround nếu không được review.

#### POC-10 — Attachments

Test:

- incoming image;
- incoming file;
- outgoing attachment callback;
- Tinix download/cache;
- Chatwoot Active Storage;
- signed/temporary URL;
- MIME/size;
- restart/retry.

#### POC-11 — Delivery state

Xác minh:

- Chatwoot default `sent`;
- Tinix delivery state không bị overwrite;
- Tinix `PATCH` status nếu dùng;
- resulting `message_updated` không enqueue outbound mới;
- Chatwoot retry UI không được coi là Tinix provider retry.

#### POC-12 — Security / account isolation

Test:

- invalid HMAC;
- stale timestamp/replay;
- wrong account;
- wrong inbox;
- cross-account access;
- service user permissions;
- agent/admin basic access.

### 4.6. Architecture Gate — BLOCKER trước Phase 1

Phase 1 **không được bắt đầu** cho đến khi:

```text
[ ] Repo Tinix đã audit
[ ] Existing queue/outbox strategy đã chọn
[ ] Chatwoot v4.18.0 CE POC chạy được
[ ] API Inbox callback HMAC/timestamp verified
[ ] Callback topology không bị SafeFetch blocker
[ ] API Inbox callback vs account webhook feed strategy được chốt
[ ] Outbound predicate đã test
[ ] Private note không thể ra provider
[ ] Incoming echo không thể ra provider
[ ] Duplicate callback không gây duplicate send
[ ] ContactInbox/source mapping pass
[ ] Conversation display/internal reference được chốt
[ ] Tinix provider delivery state authoritative được xác nhận
[ ] REST reconciliation path được chứng minh tối thiểu
[ ] Restart mapping/recovery pass
[ ] CHANGE-001 → CHANGE-004 đã resolve hoàn toàn
[ ] Không còn unresolved CRITICAL blocker
```

Nếu chưa đạt:

```text
READY WITH LIMITATIONS
```

hoặc:

```text
BLOCKED
```

Không tự chuyển sang Phase 1.

### 4.7. Deliverable Phase 0

Codex phải báo cáo:

```text
STATUS
Existing stack
Relevant reusable modules
Final module paths
DB changes
Queue/outbox choice
Chatwoot version/image/digest
POC test matrix results
Callback topology
Outbound predicate
Contact/ContactInbox mapping
Conversation ID/reference policy
Delivery-state policy
Reconciliation strategy
Security findings
Known limitations
Provider blockers
Exact Phase 1 files
Phase 1 command
```

Nếu logical path trong plan không khớp repo, giữ architectural boundary nhưng map sang conventions thực tế.

---

## 5. Kiến trúc module đề xuất

Path dưới đây là **logical layout**. Codex phải map sang repo thật sau Phase 0, không bắt buộc tạo nguyên thư mục này.

```text
tinix-inbox/
├── core/
│   ├── channel-adapter.*
│   ├── conversation-provider.*
│   ├── unified-message.*
│   ├── unified-event.*
│   ├── channel-capabilities.*
│   ├── delivery-state.*
│   ├── errors.*
│   └── types.*
│
├── channels/
│   ├── meta/
│   │   ├── meta-adapter.*
│   │   ├── meta-auth.*
│   │   ├── meta-webhook.*
│   │   ├── meta-client.*
│   │   └── meta-normalizer.*
│   ├── zalo/
│   │   ├── zalo-adapter.*
│   │   ├── zalo-auth.*
│   │   ├── zalo-webhook.*
│   │   ├── zalo-client.*
│   │   └── zalo-normalizer.*
│   ├── tiktok-shop/
│   │   ├── tiktok-shop-adapter.*
│   │   ├── tiktok-shop-auth.*
│   │   ├── tiktok-shop-webhook.*
│   │   ├── tiktok-shop-client.*
│   │   └── tiktok-shop-normalizer.*
│   └── shopee/
│       ├── shopee-adapter.*
│       ├── shopee-auth.*
│       ├── shopee-webhook.*
│       ├── shopee-client.*
│       └── shopee-normalizer.*
│
├── providers/
│   └── chatwoot/
│       ├── chatwoot-provider.*
│       ├── chatwoot-client.*
│       ├── chatwoot-callback.*
│       ├── chatwoot-account-webhook.*
│       ├── chatwoot-signature.*
│       ├── chatwoot-mapper.*
│       ├── chatwoot-reconciler.*
│       └── chatwoot-capabilities.*
│
├── events/
│   ├── inbox-event-store.*
│   ├── inbox-queue.*
│   ├── inbox-worker.*
│   ├── idempotency.*
│   └── correlation.*
│
├── messages/
│   ├── inbound-service.*
│   ├── outbound-service.*
│   ├── outbox-service.*
│   ├── delivery-service.*
│   ├── reconciliation-service.*
│   └── attachment-service.*
│
├── identity/
│   ├── channel-identity-service.*
│   ├── conversation-link-service.*
│   └── customer-link-service.*
│
├── agent/
│   ├── inbox-agent-router.*
│   ├── handoff-policy.*
│   └── agent-trigger.*
│
├── persistence/
│   ├── repositories.*
│   └── migrations/
│
├── realtime/
│   ├── inbox-event-relay.*
│   └── polling-fallback.*
│
└── api/
    ├── routes.*
    ├── connection-controller.*
    ├── callback-controller.*
    ├── webhook-controller.*
    └── inbox-controller.*
```

### 5.1. Boundary rules

- `channels/*` không import Chatwoot-specific DTO.
- `providers/chatwoot/*` không chứa Meta/Zalo/TikTok/Shopee logic.
- `agent/*` không gọi provider send API trực tiếp.
- `api/*` không expose Chatwoot/provider token.
- `realtime/*` relay Tinix domain events; frontend không cần Chatwoot ActionCable token.
- `persistence/*` là nơi giữ mappings/outbox/delivery/reconciliation cursor.

---

## 6. ChannelAdapter Contract

### 6.1. Interface tối thiểu

```ts
interface ChannelAdapter {
  readonly provider: ChannelProvider;

  validateConnection(
    credentials: EncryptedChannelCredentials
  ): Promise<ConnectionValidationResult>;

  verifyWebhook(
    request: RawWebhookRequest,
    connection: ChannelConnection
  ): Promise<WebhookVerificationResult>;

  parseWebhook(
    request: RawWebhookRequest,
    connection: ChannelConnection
  ): Promise<ProviderEvent[]>;

  normalizeEvent(
    event: ProviderEvent,
    connection: ChannelConnection
  ): Promise<UnifiedEvent[]>;

  sendMessage(
    request: ChannelSendRequest
  ): Promise<ChannelSendResult>;

  sendAttachment?(
    request: ChannelAttachmentRequest
  ): Promise<ChannelSendResult>;

  markRead?(
    request: MarkReadRequest
  ): Promise<void>;

  sendTyping?(
    request: TypingRequest
  ): Promise<void>;

  refreshCredentials?(
    connection: ChannelConnection
  ): Promise<CredentialRefreshResult>;

  getProfile?(
    externalUserId: string,
    connection: ChannelConnection
  ): Promise<ExternalProfile>;
}
```

### 6.2. Không để core phụ thuộc provider-specific fields

Provider-specific payload chỉ tồn tại ở:

- raw webhook event;
- provider metadata namespace;
- adapter implementation.

Core chỉ dùng normalized model.

---

## 7. Unified Message Model

### 7.1. Base model

```ts
type UnifiedMessage = {
  id: string;
  workspaceId: string;

  provider: "meta" | "zalo" | "tiktok_shop" | "shopee" | string;
  channelConnectionId: string;

  externalConversationId: string;
  externalMessageId: string;

  direction: "incoming" | "outgoing";
  messageType:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "file"
    | "sticker"
    | "location"
    | "product"
    | "order"
    | "unsupported";

  sender: {
    externalId: string;
    displayName?: string;
    avatarUrl?: string;
  };

  recipient?: {
    externalId: string;
  };

  text?: string;

  attachments: Array<{
    id?: string;
    type: string;
    url?: string;
    mimeType?: string;
    fileName?: string;
    sizeBytes?: number;
    providerResourceId?: string;
  }>;

  replyToExternalMessageId?: string;

  sentAt: string;
  receivedAt: string;

  providerMetadata?: Record<string, unknown>;
};
```

### 7.2. Unique idempotency key

Ưu tiên:

```text
workspace_id
+ channel_connection_id
+ external_message_id
```

Nếu provider không cung cấp message ID ổn định:

```text
provider_event_id
```

Nếu vẫn không có, fallback hash phải dựa trên payload canonicalized + sender + timestamp bucket và phải được ghi rõ là best-effort.

---

## 8. Unified Event Model

Các event chuẩn:

```text
channel.connection.created
channel.connection.updated
channel.connection.disabled
channel.credentials.expiring

channel.webhook.received
channel.message.received
channel.message.sent
channel.message.delivered
channel.message.read
channel.message.failed

conversation.created
conversation.updated

agent.reply.requested
agent.reply.created
agent.reply.skipped

handoff.ai_enabled
handoff.ai_paused
handoff.human_active

dead_letter.created
```

Mọi event phải có:

```ts
{
  eventId,
  eventType,
  workspaceId,
  correlationId,
  causationId?,
  occurredAt,
  payload
}
```

`correlationId` đi xuyên toàn bộ flow để debug một message từ webhook đến provider outbound.

---

## 9. Persistence tối thiểu — V2

Không buộc tạo đúng table names dưới đây nếu repo đã có primitive tương đương. Yêu cầu là các logical records/ràng buộc phải tồn tại.

### 9.1. `channel_connections`

```text
id
workspace_id
provider
display_name
external_account_id

status:
  pending
  connected
  degraded
  expired
  revoked
  disabled

credentials_encrypted
credential_version
scopes
metadata

chatwoot_account_id
chatwoot_inbox_id
chatwoot_api_channel_identifier
chatwoot_callback_secret_ref

created_at
updated_at
last_verified_at
last_successful_event_at
last_error
```

Unique logical identity:

```text
workspace_id + provider + external_account_id
```

Nếu provider cho phép nhiều app/context cho cùng external account, thêm connection namespace phù hợp.

### 9.2. `external_contact_links`

```text
id
workspace_id
channel_connection_id
provider
external_user_id

chatwoot_account_id
chatwoot_contact_id
chatwoot_contact_inbox_id
chatwoot_source_id

customer_identity_id?
metadata

created_at
updated_at
```

Unique:

```text
workspace_id
+ channel_connection_id
+ external_user_id
```

Không dùng `external_user_id -> contact_id` một mình.

### 9.3. Contact identifier policy

Nếu Tinix tạo `Contact.identifier`, mặc định namespace:

```text
provider:channel_connection_id:external_user_id
```

Không dùng display name.

Không dùng email/phone chưa verified để auto-merge contact.

Verified email/phone có thể phục vụ explicit identity-linking policy của Tinix, không để Chatwoot builder tự quyết cross-channel customer merge ngoài ý muốn.

### 9.4. `conversation_links`

```text
id
workspace_id
channel_connection_id

external_conversation_id?
tinix_thread_key

chatwoot_account_id
chatwoot_inbox_id
chatwoot_contact_inbox_id

chatwoot_conversation_ref
chatwoot_conversation_display_id

state
provider_last_message_at?
last_reconciled_at?

created_at
updated_at
```

Unique theo provider thread policy:

```text
workspace_id
+ channel_connection_id
+ tinix_thread_key
```

Không giả định mọi provider có `external_conversation_id`.

### 9.5. `message_links`

```text
id
workspace_id
channel_connection_id
conversation_link_id

direction
origin:
  customer
  human
  ai
  system

external_message_id?
provider_message_id?

chatwoot_account_id
chatwoot_message_id

outbox_id?
delivery_state

provider_sent_at?
provider_accepted_at?
delivered_at?
read_at?
failed_at?

correlation_id
metadata

created_at
updated_at
```

Inbound unique khi provider có stable ID:

```text
workspace_id
+ channel_connection_id
+ external_message_id
```

Outbound Chatwoot unique:

```text
chatwoot_account_id
+ chatwoot_message_id
```

### 9.6. `chatwoot_callback_events`

```text
id

chatwoot_account_id
chatwoot_inbox_id?
delivery_id?
event_type
chatwoot_message_id?
chatwoot_conversation_id?

signature_valid
timestamp_valid
payload_hash

raw_payload_or_storage_ref
status
attempt_count

correlation_id
received_at
processed_at
last_error
```

Semantic dedupe key cho message event phải bao gồm object ID, không chỉ delivery ID.

### 9.7. `provider_webhook_events`

```text
id
workspace_id?
provider
channel_connection_id?
provider_event_id?

signature_valid
payload_hash
raw_payload_or_storage_ref

status
attempt_count
correlation_id

received_at
processed_at
last_error
```

### 9.8. `outbox_messages`

```text
id
workspace_id
channel_connection_id
conversation_link_id

chatwoot_account_id
chatwoot_message_id

idempotency_key
payload_snapshot_or_ref

state:
  pending
  sending
  provider_accepted
  retry_wait
  unknown
  failed
  dead_letter

attempt_count
next_attempt_at

provider_message_id?
provider_response_ref?

correlation_id
created_at
claimed_at?
sent_at?
last_error
```

Hard unique:

```text
chatwoot_account_id
+ chatwoot_message_id
```

### 9.9. `message_delivery`

Nếu delivery fields không nằm trong `message_links/outbox`, tạo projection riêng:

```text
message_link_id
state

queued_at
sending_at
provider_accepted_at
delivered_at
read_at
failed_at

provider_status
provider_status_payload_ref?
last_verified_at
```

Tinix authoritative.

### 9.10. `conversation_ai_state`

```text
workspace_id
conversation_provider
provider_conversation_id

mode:
  ai
  hybrid
  human
  paused

version
pause_reason
human_owner_id?
last_ai_message_at?
last_human_message_at?
updated_at
```

`version` dùng optimistic concurrency/race protection.

### 9.11. `reconciliation_cursors`

```text
id
workspace_id
source:
  chatwoot
  provider

scope_type
scope_id

watermark
overlap_window
last_started_at
last_success_at
last_error
```

Không giữ reconciliation cursor chỉ trong memory.

### 9.12. Persistence rule

Mọi mapping quan trọng phải survive:

```text
Tinix restart
Chatwoot restart
worker restart
Redis transient failure
```

Không phụ thuộc cache/memory cho source-of-truth mapping.

---

## 10. Chatwoot Integration — V2

### 10.1. Edition và version baseline

V1 dùng:

```text
Chatwoot Community Edition
Research baseline: v4.18.0
```

Không phụ thuộc:

- Captain AI;
- Enterprise SSO/SAML;
- custom roles/permissions paid;
- Enterprise audit logs;
- paid-only features khác.

Tinix tự quản AI, tenant RBAC/audit cần thiết cho product.

Production image phải pin exact version + digest sau khi Phase 0 xác minh image thực tế.

Không dùng `latest`.

### 10.2. API surface

Tinix backend ưu tiên **Application API server-to-server** với service user/account-scoped access cho:

- Contact;
- ContactInbox;
- Conversation;
- Message;
- assignment;
- labels;
- status;
- private notes;
- attachments.

Không dùng Public Client API như server secret API.

### 10.3. API Inbox strategy

V1 chọn:

```text
1 Chatwoot API Inbox / 1 connected provider account
```

Ví dụ:

```text
Facebook Page A -> API Inbox A
Facebook Page B -> API Inbox B
Zalo OA A       -> API Inbox C
```

Lợi ích:

- routing rõ;
- callback secret tách;
- inbox membership tách;
- reconnect/health dễ;
- provider account identity rõ.

Số inbox thực tế ở scale lớn phải load test; không coi là unlimited.

### 10.4. Mapping bắt buộc

```text
(workspace_id, channel_connection_id)
    -> chatwoot_account_id
    -> chatwoot_inbox_id
    -> api_channel_identifier

(workspace_id, channel_connection_id, external_user_id)
    -> chatwoot_contact_id
    -> chatwoot_contact_inbox_id
    -> chatwoot_source_id

(workspace_id, channel_connection_id, tinix_thread_key)
    -> chatwoot_conversation_display_id
    -> chatwoot_contact_inbox_id

(workspace_id, channel_connection_id, direction, external_message_id)
    -> chatwoot_message_id
    -> provider_message_id
    -> outbox_id
    -> Tinix delivery state
```

Không đồng nhất:

```text
Chatwoot DB internal conversation id
```

với:

```text
REST/webhook display_id
```

POC phải xác minh exact response/reference.

### 10.5. Incoming provider flow

```text
Provider webhook
      │
      ▼
verify provider authenticity
      │
      ▼
persist durable provider event
      │
      ▼
ACK provider nhanh
      │
      ▼
async worker
      │
      ▼
dedupe
      │
      ▼
ChannelAdapter.normalize()
      │
      ▼
resolve/create Tinix ChannelIdentity
      │
      ▼
resolve/create Chatwoot Contact + ContactInbox
      │
      ▼
resolve/create Conversation
      │
      ▼
POST Chatwoot incoming message
      │
      ▼
save mapping
      │
      ▼
Chatwoot callback echo incoming
      │
      ▼
reconcile only — never provider send
```

### 10.6. Single outbound path

**Human và AI đều phải tạo outgoing message qua ConversationProvider/Chatwoot.**

```text
Human Chatwoot UI
        OR
Tinix AI via ConversationProvider
        │
        ▼
Chatwoot outgoing message
        │
        ▼
API Inbox callback
        │
        ▼
Tinix callback durable receipt
        │
        ▼
strict outbound predicate
        │
        ▼
Tinix Outbox
        │
        ▼
ChannelAdapter.sendMessage()
        │
        ▼
Provider
```

Không có:

```text
AI -> provider trực tiếp
```

song song với Chatwoot.

### 10.7. Outbound predicate — bắt buộc

Chỉ enqueue provider outbound khi **tất cả** đúng:

```text
event == message_created
chatwoot_account_id matches mapped workspace
chatwoot_inbox_id matches mapped connection
message_type == outgoing
private == false
chatwoot_message_id exists
chatwoot_message_id has no existing outbox
message category/type allowed by Tinix capability policy
conversation mapping exists
connection is enabled/eligible to send
```

`sender_type` dùng cho audit/provenance, không thay thế `message_type/private`.

### 10.8. Private note rule

```text
private == true
```

=> **never send to customer provider**.

Private note vẫn có thể là outgoing ở Chatwoot, nên filter theo `outgoing` một mình là sai.

### 10.9. Incoming echo rule

Incoming message do Tinix POST vào Chatwoot có thể tạo callback.

Rule:

```text
message_type == incoming
```

=> không enqueue outbound.

Có thể dùng callback để:

- reconcile mapping;
- relay realtime;
- update projection;
- trigger downstream internal event nếu cần.

### 10.10. `message_updated` rule

`message_updated`:

- không tạo outbox mới;
- chỉ dùng projection/reconcile;
- REST fetch nếu cần field không có trong callback;
- Tinix status patch không được dẫn đến resend.

### 10.11. Template/activity

`activity`:

- không gửi ra provider.

`template`:

- explicit allow/deny policy;
- không mặc định coi giống outgoing customer message;
- chỉ enable khi ChannelAdapter/provider capability hỗ trợ use case cụ thể.

### 10.12. API Inbox callback vs account webhook

**Preferred V1:**

```text
API Inbox callback
→ message events

Account webhook
→ contact/conversation events
```

Nếu account webhook cũng subscribe message events:

- semantic dedupe;
- không tạo hai outbox cho cùng Chatwoot message;
- không dựa vào delivery header một mình để chống duplicate cross-feed.

### 10.13. Callback verification

Receiver phải:

1. giữ raw body;
2. verify đúng secret của source:
   - API Inbox callback secret;
   - account webhook secret;
3. verify `X-Chatwoot-Timestamp`;
4. verify `X-Chatwoot-Signature`;
5. constant-time compare;
6. enforce replay window;
7. verify account/inbox allowlist;
8. persist durable event;
9. chỉ sau đó trả `2xx`.

Không expose callback secret cho frontend.

### 10.14. Callback reliability

Không coi callback là guaranteed queue.

Tinix phải có:

```text
durable receipt
+
semantic idempotency
+
REST reconciliation
```

Reconciliation mục tiêu:

- tìm Chatwoot outgoing messages mới/thiếu outbox;
- giới hạn theo inbox/time window;
- dùng overlap window;
- không blind-resend message đã có provider outcome `unknown`.

### 10.15. Chatwoot callback failure semantics

Nếu callback fail, Chatwoot API Inbox có thể mark message `failed`.

Tinix không được diễn giải:

```text
Chatwoot failed
```

thành:

```text
provider delivery failed
```

một cách tự động.

Tinix delivery state vẫn authoritative.

### 10.16. Chatwoot retry UI

Không dựa vào Chatwoot API Inbox retry UI/`SendReplyJob` như provider resend mechanism của Tinix.

Retry provider phải đi qua:

```text
Tinix outbox
```

và giữ cùng semantic message identity.

### 10.17. SafeFetch/network topology

Phase 0 phải test callback URL trong deployment thật.

Nếu Chatwoot SafeFetch chặn private network:

- ưu tiên controlled HTTPS callback/reverse proxy/allowlist architecture;
- không bật global allow-private-network mặc định nếu chưa review security impact.

### 10.18. Chatwoot outage

Nếu Chatwoot API unavailable:

- provider webhook vẫn durable-persist ở Tinix;
- provider ACK sau persist;
- processing retry async;
- no message loss do Chatwoot outage;
- backlog observable;
- dead-letter nếu vượt retry policy.

### 10.19. Tinix receiver outage

Nếu Tinix Chatwoot callback receiver unavailable:

- Chatwoot callback có thể không được replay tự động;
- Tinix phải reconcile REST sau recovery;
- monitor callback/reconciliation lag;
- không suy ra exactly-once.

### 10.20. No direct Chatwoot DB access

Production Tinix code:

```text
NEVER read/write Chatwoot PostgreSQL directly
```

trừ khi một architectural decision mới được duyệt rõ.

Dùng supported API/callback/webhook.

---

## 11. AI Agent Integration

### 11.1. Trigger point

AI trigger chỉ chạy sau khi incoming message đã được ghi thành công vào ConversationProvider.

Preferred:

```text
Chatwoot incoming message created
      ↓
Tinix Agent Trigger
```

hoặc internal event được phát ngay sau Chatwoot success, miễn đảm bảo exactly-once/best-effort-once semantics.

### 11.2. AI eligibility

Trước khi gọi model:

```ts
if (!workspace.aiEnabled) skip;
if (!connection.aiEnabled) skip;
if (!conversation.aiEnabled) skip;
if (conversation.mode === "human") skip;
if (conversation.mode === "paused") skip;
if (message.isFromSelf) skip;
if (message.isSystem) skip;
if (message.isDuplicate) skip;
```

### 11.3. Agent context

Context tối thiểu:

- current user message;
- recent conversation messages;
- contact profile;
- channel/provider;
- workspace policies;
- business knowledge/RAG;
- order/customer tools khi có;
- language;
- handoff state.

Không đưa raw provider credentials vào context.

### 11.4. Agent output

Agent không trực tiếp gọi provider send API.

Agent tạo:

```text
Chatwoot outgoing message
```

kèm metadata:

```json
{
  "tinix_origin": "ai",
  "tinix_agent_id": "...",
  "correlation_id": "..."
}
```

Nếu Chatwoot API không hỗ trợ đúng metadata field mong muốn, lưu correlation trong Tinix DB và chỉ dùng field Chatwoot phù hợp hiện có.

---

## 12. AI / Human Handoff

### 12.1. Modes

```text
AI
HYBRID
HUMAN
PAUSED
```

Ý nghĩa:

**AI**
- AI tự reply.

**HYBRID**
- AI có thể draft/assist.
- auto-send phụ thuộc policy.

**HUMAN**
- AI không auto-send.
- human operator chịu trách nhiệm.

**PAUSED**
- không auto reply;
- giữ conversation active.

### 12.2. Auto-pause AI

Tối thiểu hỗ trợ:

- human gửi message thủ công;
- conversation assigned cho human nếu policy bật;
- label/tag `ai_off` hoặc equivalent;
- explicit UI action "Take over";
- AI phát hiện tình huống cần escalation.

### 12.3. Resume AI

Không tự resume chỉ vì human không hoạt động.

Resume phải theo một trong:

- explicit "Resume AI";
- conversation resolved/reopened theo policy rõ ràng;
- timeout policy được cấu hình và hiển thị cho user.

### 12.4. Race-condition protection

Khi AI đang generate mà human takeover:

1. Agent lấy current handoff version.
2. Trước khi tạo outgoing message, re-check version/state.
3. Nếu state đổi sang HUMAN/PAUSED => discard AI send.
4. Ghi event `agent.reply.skipped`.

---

## 13. Queue / Durable Event Layer

### 13.1. Không hardcode technology trước repo audit

Ưu tiên tái sử dụng queue hiện có.

Nếu Tinix chưa có queue:

- MVP nhỏ: durable DB job/outbox.
- Redis-based queue nếu Redis đã có.
- Không đưa Kafka chỉ vì "scale" khi chưa cần.

### 13.2. Retry policy

Phân loại lỗi:

**Retryable**
- timeout;
- 429;
- 5xx;
- temporary network;
- provider transient errors.

**Non-retryable**
- invalid payload;
- unsupported type;
- permission revoked;
- malformed credentials;
- recipient invalid nếu provider xác nhận permanent.

Backoff:

```text
attempt 1: immediate
attempt 2: ~5s
attempt 3: ~30s
attempt 4: ~2m
attempt 5: ~10m
attempt 6+: configurable / dead-letter
```

Có jitter nếu queue system hỗ trợ.

### 13.3. Idempotent sender

Mỗi outbox item có stable `idempotency_key`.

Worker crash/restart không được gây gửi duplicate nếu có thể kiểm soát.

Nếu provider không hỗ trợ idempotency key, Tinix phải giữ transaction state và xử lý at-least-once cẩn thận.

---

## 14. Attachment Strategy — V2

MVP support tối thiểu:

```text
text
image
file
```

Sau đó:

```text
video
audio
sticker
product/order cards
```

### 14.1. Hybrid storage

V2 chọn **hybrid storage**:

**Tinix lưu authoritative transport reference/durable copy khi cần:**

- provider URL tạm thời;
- retry cần file tồn tại lâu;
- audit/retention policy yêu cầu;
- provider upload cần bytes local/object storage.

**Chatwoot Active Storage dùng cho operator experience:**

- xem attachment;
- human reply;
- conversation history.

### 14.2. Không assume remote URL ingestion

Không giả định Chatwoot Application Message API sẽ tự fetch arbitrary remote URL.

Flow chuẩn:

```text
provider media
→ Tinix validate/fetch
→ Tinix durable object/reference
→ upload Chatwoot attachment khi cần
```

Outbound:

```text
Chatwoot attachment callback
→ Tinix authorized fetch
→ validate MIME/size
→ ChannelAdapter provider upload
```

### 14.3. Security

Bắt buộc:

- giới hạn size;
- MIME allowlist;
- chống SSRF;
- không trust filename;
- signed/private access;
- malware scanning nếu product risk yêu cầu;
- retention policy;
- không public raw provider URL lâu dài.

### 14.4. Provider capability

Attachment UI/send chỉ enable khi `ChannelCapabilities` hỗ trợ.

### 14.5. POC

Phase 0 test:

```text
incoming image
incoming file
outgoing file
signed URL expiry
restart/retry
MIME mismatch
oversized file
temporary provider URL
```

Không chốt global max size từ Chatwoot WebWidget assumptions; xác minh API Inbox + infrastructure + provider separately.

---

## 15. Channel Rollout

### 15.1. Meta — Facebook Messenger / Instagram

**Priority: P0 channel**

Codex phải thực hiện capability spike trước coding production:

- xác minh API/version hiện tại;
- permissions cần thiết;
- webhook subscriptions;
- app review requirements;
- Page/Instagram account requirements;
- token lifecycle;
- message window/rules;
- supported attachment types;
- delivery/read events nếu available;
- rate limits.

Implementation:

```text
Meta webhook
  -> MetaAdapter.verifyWebhook
  -> MetaAdapter.parseWebhook
  -> normalize
  -> Chatwoot API Channel
```

Outbound:

```text
Chatwoot outgoing
  -> Tinix Outbox
  -> MetaAdapter.sendMessage
```

Acceptance:

- Facebook incoming text.
- Facebook outgoing text.
- Instagram incoming/outgoing nếu permissions được cấp.
- Duplicate webhook.
- Token expired.
- Provider 429.
- Image attachment.

### 15.2. Zalo OA

**Priority: P1 channel**

Spike:

- OA authorization.
- official account/user mapping.
- webhook signature/verification.
- inbound event schema.
- outbound message API.
- access token + refresh lifecycle.
- quota/rate limits.
- message eligibility rules.
- media support.

Không hardcode assumptions từ tài liệu cũ; dùng current Zalo OA OpenAPI docs tại thời điểm triển khai.

Acceptance:

- connect OA.
- receive message.
- create Chatwoot conversation.
- human reply.
- AI reply.
- token refresh.
- reconnect after revoked authorization.
- image support nếu API account test cho phép.

### 15.3. TikTok Shop Customer Service

**Priority: P2 channel sau capability verification**

Tài liệu TikTok Shop hiện có Customer Service APIs và scope `seller.customer_service`, nhưng quyền sử dụng thực tế có thể phụ thuộc app approval, seller authorization, region hoặc platform enablement.

Spike bắt buộc:

- app eligibility;
- scope approval;
- supported markets;
- get conversation/messages;
- send message;
- webhook/event mechanism;
- token lifecycle;
- shop cipher/account mapping;
- attachment upload;
- platform policy.

Không đánh dấu production-ready nếu chỉ gọi được read API nhưng chưa xác minh send + event delivery.

Acceptance:

- authorized shop connection.
- incoming event/poll fallback nếu official mechanism yêu cầu.
- conversation map.
- outgoing text.
- attachment.
- revoked permission behavior.

### 15.4. Shopee

**Priority: P3 / capability-gated**

Không commit kiến trúc production dựa trên assumption rằng mọi Shopee app đều được quyền customer chat.

Codex phải tạo một **Shopee Messaging Capability Report** trong execution report:

```text
Region/market tested:
Partner/app type:
Available messaging endpoints:
Webhook availability:
Required scopes:
Approval requirements:
Can read customer chat: yes/no
Can send customer chat: yes/no
Can receive realtime event: yes/no
Attachment support:
Known restrictions:
Conclusion:
```

Nếu direct official API không được cấp:

- giữ `ShopeeAdapter` interface;
- mark connector `Unavailable / Requires Partner Access`;
- không scrape Shopee web UI;
- không dùng browser automation như production transport;
- không đưa unofficial credential/session theft workaround.

---

## 16. Connection Management API

Tinix cần endpoints/services tương đương:

```text
GET    /inbox/channels
GET    /inbox/connections
POST   /inbox/connections/:provider/start
GET    /inbox/connections/:provider/callback
POST   /inbox/connections/:id/verify
POST   /inbox/connections/:id/reconnect
POST   /inbox/connections/:id/disable
DELETE /inbox/connections/:id
GET    /inbox/connections/:id/health
```

Tên path phải theo repo conventions.

Response không bao giờ trả raw access token.

---

## 17. Webhook API

Logical routes:

```text
GET/POST /webhooks/inbox/meta/:connectionKey
POST     /webhooks/inbox/zalo/:connectionKey
POST     /webhooks/inbox/tiktok-shop/:connectionKey
POST     /webhooks/inbox/shopee/:connectionKey

POST     /webhooks/inbox/chatwoot/:workspaceKey
```

Requirements:

- connection key không phải secret duy nhất;
- verify signature;
- rate limit;
- body size limit;
- content-type validation;
- correlation ID;
- structured logging;
- persistence trước async processing;
- không log token/signature/raw sensitive customer data không cần thiết.

---

## 18. Tinix Inbox UI Roadmap — V2

### 18.1. V0 — Operator validation

Dùng Chatwoot dashboard trực tiếp để validate:

- conversation sync;
- human reply;
- AI reply;
- private note;
- assignment;
- handoff;
- delivery/retry behavior.

Tinix UI ban đầu chỉ cần:

```text
Tinix Inbox
  Channels
  Connection status
  AI mode
  Provider health
  Chatwoot integration health
  Internal/dev link to Chatwoot
```

Không clone Chatwoot UI ở Phase 0/1.

### 18.2. V1 — Native Tinix Inbox shell

```text
Tinix Inbox

├── Conversations
├── Contacts
├── Channels
├── AI Agent
└── Settings
```

Frontend chỉ gọi:

```text
Tinix Backend Facade
```

không gọi Chatwoot trực tiếp.

### 18.3. Conversation UI

Conversation list:

- avatar;
- contact name;
- channel badge;
- last message;
- unread state;
- assignee;
- AI/Human status;
- timestamp.

Conversation detail:

- message timeline;
- attachments;
- reply composer;
- internal note mode nếu supported;
- AI state;
- Take Over / Resume AI;
- contact context;
- delivery state;
- retry khi Tinix cho phép.

### 18.4. Delivery UX

UI dùng **Tinix delivery state**, không dùng Chatwoot default status làm truth.

Possible states:

```text
Queued
Sending
Sent / Provider accepted
Delivered
Read
Failed
Unknown
```

Chỉ render `Delivered/Read` khi provider capability xác minh.

`Unknown` phải có UX riêng; không blind retry nếu có duplicate risk.

### 18.5. Retry UX

Retry button gọi:

```text
Tinix Outbox Retry
```

không phụ thuộc Chatwoot retry UI.

### 18.6. Realtime

Chatwoot ActionCable là implementation detail.

Native Tinix UI nên dùng:

```text
Tinix WebSocket/SSE relay
```

hoặc repository realtime primitive tương đương.

Fallback:

```text
REST refresh / polling with cursor/window
```

Không expose Chatwoot pubsub token/frontend dependency.

### 18.7. Search/unread capability

V1 phải đánh dấu capability theo backend thực tế:

```text
SUPPORTED
PARTIAL
NOT VERIFIED
NOT SUPPORTED
```

Không hứa global search/unread semantics vượt quá API/POC đã chứng minh.

### 18.8. V2 UI mở rộng

Sau infrastructure ổn định:

```text
search
filters
labels
assignment/team
private notes
customer profile
orders
AI drafts
automation
analytics
```

Không block stable messaging release bằng analytics/campaign/workflow builder.

---

## 19. n8n Integration — Optional

n8n không được required để Tinix Inbox gửi/nhận message.

Correct:

```text
Tinix Agent
   ↓ tool call
n8n
   ↓
CRM / ERP / Google Sheets / Email / order systems
```

Incorrect:

```text
Facebook
   ↓
n8n
   ↓
Chatwoot
   ↓
n8n
   ↓
AI
   ↓
n8n
```

### 19.1. Tool abstraction

```ts
interface AutomationTool {
  execute(
    action: string,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult>;
}
```

Possible implementation:

```text
N8nAutomationTool
NativeAutomationTool
DirectApiTool
```

### 19.2. Licensing boundary

Trước khi expose n8n workflows/credentials trực tiếp cho external Tinix customers hoặc embed n8n UI trong sản phẩm, phải review license/commercial terms hiện hành.

V1 chỉ coi n8n là internal/optional integration.

---

## 20. Security — V2

### 20.1. Secrets

Provider credentials và Chatwoot integration secrets phải:

- encrypted at rest;
- redacted khỏi logs;
- không trả frontend;
- có key/version nếu repo hỗ trợ;
- hỗ trợ rotation;
- tách dev/staging/prod.

Bao gồm:

```text
provider access/refresh tokens
Chatwoot service user token
API Inbox callback secret
account webhook secret
OAuth client secret
```

### 20.2. OAuth/provider auth

- `state`/nonce;
- PKCE khi phù hợp;
- callback allowlist;
- expiry tracking;
- refresh locking;
- revoke/disconnect;
- minimum required scopes.

### 20.3. Provider webhook

- verify signature;
- raw body khi provider yêu cầu;
- timestamp/replay check;
- payload size limit;
- content-type validation;
- rate limit;
- durable persist trước async work.

### 20.4. Chatwoot callback/webhook

Phân biệt hai source secret.

Receiver phải:

```text
verify HMAC
verify timestamp
constant-time compare
validate account/inbox mapping
persist durable receipt
ACK 2xx after persist
```

Invalid signature/replay:

```text
reject
log structured metadata
increment security metric
```

Không log secret/raw customer content không cần thiết.

### 20.5. SafeFetch/network exposure

Không mở private network rộng chỉ để Chatwoot callback hoạt động.

POC phải xác minh:

- reverse proxy;
- DNS;
- TLS;
- source routing;
- callback allowlist;
- Chatwoot SafeFetch behavior.

### 20.6. Tenant isolation

Mọi Tinix query/mapping bắt đầu bằng:

```text
workspace_id
```

Không lookup global chỉ bằng:

```text
external_user_id
chatwoot_message_id
chatwoot_conversation_id
```

nếu ID không global-safe.

Mapping invariant:

```text
workspace
→ Chatwoot account
→ Inbox
→ ChannelConnection
```

phải verify trên mọi callback/request.

### 20.7. Chatwoot account strategy

V1 mặc định:

```text
1 Chatwoot Account / 1 Tinix workspace
```

trong shared Chatwoot deployment.

Không dùng Chatwoot basic roles như tenant boundary thay cho Tinix authorization.

### 20.8. RBAC/audit

Chatwoot CE basic agent/admin/inbox membership đủ cho operator validation.

Tinix phải tự quản:

- product-level workspace RBAC;
- audit cần cho Tinix;
- access checks cho native UI.

Không phụ thuộc Enterprise custom roles/audit logs cho MVP.

### 20.9. Data minimization

Không giữ raw webhook/callback vô hạn.

Retention config cho:

- provider raw events;
- Chatwoot callback raw events;
- failed jobs;
- debug payload;
- attachment cache.

### 20.10. Direct DB access

Không đọc/write Chatwoot DB trực tiếp từ Tinix production code.

---

## 21. Observability

Structured log fields:

```text
workspace_id
provider
channel_connection_id
correlation_id
webhook_event_id
external_message_id
conversation_provider
conversation_id
message_id
attempt
duration_ms
result
error_code
```

Metrics tối thiểu:

```text
webhooks_received_total
webhooks_invalid_total
messages_inbound_total
messages_outbound_total
message_duplicates_total
message_send_failures_total
queue_depth
dead_letter_count
provider_429_total
chatwoot_errors_total
ai_replies_total
ai_replies_skipped_total
human_takeovers_total
end_to_end_latency_ms
```

Health:

```text
Tinix Inbox overall
Chatwoot
queue
database
per-channel connection
credential expiry
```

---

## 22. Error Model

Core error classes logical:

```text
AuthenticationError
AuthorizationError
WebhookVerificationError
RateLimitError
ProviderTemporaryError
ProviderPermanentError
UnsupportedMessageError
ConversationProviderError
DuplicateEventError
CredentialExpiredError
ConnectionDisabledError
```

Mỗi error có:

```text
code
retryable
provider?
http_status?
safe_message
internal_details
```

Không leak provider response chứa credentials cho UI.

---

## 23. API Rate Limiting

Tách:

1. inbound webhook endpoint protection;
2. provider outbound throttle;
3. workspace quota;
4. AI request quota.

Rate limiter provider phải key theo connection/account, không global toàn app nếu provider quota per account.

429:

- parse retry-after khi có;
- reschedule;
- không loop tight retry.

---

## 24. Delivery Status — Tinix authoritative

### 24.1. Internal state machine

Tinix authoritative states:

```text
queued
sending
provider_accepted
delivered
read
retry_wait
unknown
failed
dead_letter
```

UI có thể map `provider_accepted` thành label `Sent` nếu phù hợp.

### 24.2. Chatwoot status không authoritative

Chatwoot message có thể mặc định `sent` trước khi provider xác nhận.

Do đó:

```text
Chatwoot sent != provider accepted
```

Tinix không dùng Chatwoot status để quyết định retry/provider delivery.

### 24.3. Provider capability

Adapter khai:

```ts
type ChannelCapabilities = {
  inboundText: boolean;
  outboundText: boolean;
  attachments: string[];
  deliveryReceipts: boolean;
  readReceipts: boolean;
  markRead: boolean;
  typing: boolean;
  reactions: boolean;
  replyToMessage: boolean;
};
```

Nếu provider không có delivery/read:

- không fabricate;
- state dừng ở `provider_accepted` hoặc `unknown/failed`.

### 24.4. Status projection về Chatwoot

Tinix có thể `PATCH` Chatwoot message status khi:

- API Inbox hỗ trợ;
- provider evidence đủ;
- mapping chắc chắn.

`message_updated` do patch:

- không enqueue outbound;
- chỉ projection/reconcile.

### 24.5. Unknown state

Nếu provider có thể đã nhận message nhưng Tinix crash/timeout trước khi persist outcome:

```text
unknown
```

Không blind retry.

Ưu tiên:

1. provider idempotency key;
2. provider lookup/query;
3. manual/operator reconciliation nếu không có lookup.

### 24.6. Retry owner

Provider resend/retry thuộc:

```text
Tinix Outbox
```

không thuộc Chatwoot retry UI.

---

## 25. Capability Registry

Tạo registry runtime/config:

```ts
{
  provider: "zalo",
  capabilities: {
    outboundText: true,
    attachments: ["image"],
    deliveryReceipts: false,
    typing: false
  }
}
```

Không viết UI với assumption tất cả channel giống nhau.

---

## 26. Conversation Identity Rules — V2

### 26.1. Không auto-merge cross-channel bằng tên

Ví dụ:

```text
Facebook "Nguyen Van A"
Zalo "Nguyen Van A"
```

mặc định là hai external identities.

Merge chỉ khi có deterministic/verified evidence:

- explicit user/operator merge;
- verified phone;
- verified email;
- CRM identity mapping;
- deterministic business identifier.

### 26.2. Contact namespace

Default Chatwoot/Tinix external identity key:

```text
workspace_id
+ channel_connection_id
+ external_user_id
```

Nếu tạo Chatwoot `Contact.identifier`, namespace theo provider/connection.

Không gửi unverified phone/email vào create flow nếu nó có thể khiến Chatwoot merge ngoài ý muốn.

### 26.3. ContactInbox là mapping bắt buộc

Tinix phải lưu:

```text
chatwoot_contact_id
chatwoot_contact_inbox_id
chatwoot_source_id
chatwoot_inbox_id
```

Không chỉ lưu contact ID.

### 26.4. Conversation policy theo provider

Mỗi provider phải khai policy:

```text
external_thread_id available?
single active thread per customer?
multiple provider threads?
reopen same conversation?
create new conversation?
```

Nếu provider không có stable conversation ID:

```text
tinix_thread_key
```

được tạo theo policy ổn định.

### 26.5. Chatwoot status không đồng nghĩa AI state

```text
open/resolved/pending/snoozed
```

là support state.

Không map trực tiếp sang:

```text
AI/HYBRID/HUMAN/PAUSED
```

AI state lưu ở Tinix.

### 26.6. Conversation references

Tinix phải phân biệt rõ:

```text
Chatwoot API/display reference
Chatwoot internal DB ID nếu response có
Tinix conversation_link ID
provider external conversation ID
```

Production code không query Chatwoot DB để resolve confusion.

---

## 27. Message Ordering

Webhook có thể:

- đến trễ;
- duplicate;
- out of order.

Store:

```text
provider_sent_at
tinix_received_at
sequence/provider cursor nếu có
```

Conversation timeline ưu tiên provider timestamp nhưng phải giữ stable tie-breaker.

Không assume arrival order = send order.

---

## 28. Failure Recovery — V2

### Scenario A — Tinix restart

Pending:

```text
provider events
Chatwoot callback events
outbox
reconciliation cursor
```

phải survive và resume.

### Scenario B — Chatwoot API down

Provider webhook:

```text
persist Tinix
→ ACK provider
→ retry Chatwoot sync async
```

Không để Chatwoot outage làm mất provider message.

### Scenario C — Chatwoot worker/Redis issue

- monitor callback queue age;
- expect delayed/missed callback under failure;
- reconciliation REST after recovery;
- không coi ActionCable/callback là source of truth duy nhất.

### Scenario D — Tinix callback receiver down

Sau recovery:

- run Chatwoot REST reconciliation;
- find outgoing messages without outbox;
- use overlap window/watermark;
- semantic dedupe;
- do not auto-send if provider outcome may already be unknown.

### Scenario E — Provider down / 429 / 5xx

Outbox:

```text
retry_wait
```

Backoff + jitter.

Không tight loop.

### Scenario F — Provider accepted + Tinix crash before persist

Duplicate-risk window.

Ưu tiên:

- provider idempotency;
- provider lookup;
- transaction/outbox state;
- `unknown` nếu không thể chứng minh.

Không blind resend.

### Scenario G — Callback failure marks Chatwoot failed

Không map trực tiếp sang provider failure.

Tinix provider delivery state vẫn authoritative.

Reconcile Chatwoot projection sau.

### Scenario H — Credential revoked

```text
connection.status = revoked/degraded
```

- stop blind send retry;
- surface reconnect;
- preserve queued data theo policy;
- do not discard conversation history.

### Scenario I — Attachment URL expired

Nếu attachment cần retry:

- dùng Tinix durable object/reference;
- không phụ thuộc provider temporary URL.

### Scenario J — Chatwoot upgrade failure

Rollback cần consistent snapshot:

```text
Chatwoot DB
Active Storage
secrets/config
relevant Redis persistence if required
exact image/tag
```

Không giả định downgrade Docker image sau migration là đủ.

### Reconciliation rule

Reconciliation là requirement production, không optional optimization.

Metrics:

```text
last_successful_reconcile
reconciliation_lag
missing_outbox_detected
unknown_delivery_count
```

Global changed-message cursor chưa được research xác nhận; Phase 0/Hardening phải benchmark window-based sweep.

---

## 29. Chatwoot Deployment — V2

### 29.1. Version pinning

Research baseline:

```text
Chatwoot CE v4.18.0
release date: 2026-09-18
```

Phase 0 phải xác minh image thực tế và pin:

```text
exact CE image tag
+
image digest
```

Không dùng:

```text
latest
develop
master
```

production.

### 29.2. Topology

Recommended logical isolation:

```text
Tinix app
Tinix DB
Tinix queue/outbox

Chatwoot web
Chatwoot Sidekiq worker
Chatwoot PostgreSQL
Chatwoot Redis
Chatwoot Active Storage / object storage

reverse proxy / TLS
```

Có thể cùng host POC/dev, nhưng production concerns phải tách logical service boundaries.

Tinix không đọc/write Chatwoot DB trực tiếp.

### 29.3. Callback networking

Reverse proxy phải:

- hỗ trợ TLS;
- giữ raw request body;
- forward required headers;
- hỗ trợ WebSocket nếu dùng Chatwoot UI;
- test `api_access_token` header behavior nếu proxy config ảnh hưởng underscore headers;
- đảm bảo Chatwoot SafeFetch gọi được Tinix callback theo policy.

### 29.4. Upgrade strategy

Không auto-follow minor releases.

Flow:

```text
security/release review
→ staging upgrade
→ migrations
→ contract POC
→ callback HMAC test
→ outgoing/private-note test
→ attachment test
→ backup verification
→ production rollout
```

### 29.5. Rollback

Không giả định migrations backward-compatible.

Trước upgrade:

- backup Chatwoot DB;
- backup object storage;
- backup config/secrets;
- record exact image digest;
- define restore point.

Rollback bằng consistent restore snapshot nếu migration không safely reversible.

### 29.6. Backup

Backup tối thiểu:

```text
Chatwoot PostgreSQL
Chatwoot Active Storage
Chatwoot config/secrets
Tinix DB
Tinix object storage
```

Restore drill phải được test trước production hardening completion.

### 29.7. Capacity

Research docs resource figures là guideline, không benchmark.

Load test theo target Tinix thật:

- messages/sec;
- concurrent operators;
- accounts/workspaces;
- inbox count;
- contacts;
- history depth;
- media volume;
- callback queue lag;
- REST reconciliation cost.

---

## 30. Development Environments

### Local

Có docker/dev stack cho:

```text
Tinix
Chatwoot
DB
Redis/queue nếu cần
```

Provider webhook dev:

- tunnel only for development;
- no tunnel token committed;
- environment-specific callback URLs.

### Staging

- riêng provider app/account nếu platform cho phép;
- riêng Chatwoot;
- test accounts;
- production-like callback URLs.

### Production

- TLS.
- secret rotation.
- backup.
- monitoring.
- alerting.
- least privilege.

---

## 31. Feature Flags

Tối thiểu:

```text
tinix_inbox_enabled
tinix_inbox_ai_enabled
tinix_inbox_meta_enabled
tinix_inbox_zalo_enabled
tinix_inbox_tiktok_shop_enabled
tinix_inbox_shopee_enabled
tinix_inbox_native_ui_enabled
tinix_inbox_n8n_tools_enabled
```

Nếu project có feature flag framework thì reuse.

---

## 32. Test Strategy — V2

### 32.1. Unit tests

Bắt buộc cover:

- provider payload normalization;
- provider webhook signature;
- Chatwoot HMAC/timestamp validation;
- semantic callback dedupe;
- outbound predicate;
- private-note filter;
- incoming echo filter;
- template/activity policy;
- idempotency keys;
- ContactInbox mapping;
- conversation thread-key policy;
- delivery state transitions;
- retry classification;
- unknown state;
- handoff version/race;
- capability registry;
- credential expiry;
- unsupported message behavior.

### 32.2. DB constraint tests

Verify:

```text
unique inbound external message
unique Chatwoot outbound message -> outbox
workspace scoping
ContactInbox link uniqueness
reconciliation cursor persistence
```

Concurrency test duplicate callback race.

### 32.3. Chatwoot contract/integration tests

Real local Chatwoot CE baseline:

```text
create API Inbox
create contact
create ContactInbox/source
create conversation
create incoming
receive callback
human outgoing
private note
message status patch
assignment
labels/status
attachments
HMAC
```

Không mock toàn bộ Chatwoot cho architecture acceptance.

### 32.4. Callback reliability tests

Mô phỏng:

```text
duplicate
reorder
timeout
receiver 500
receiver down
worker delay
Tinix restart
Chatwoot restart
```

Acceptance:

- no duplicate provider send;
- reconcile tìm missing signal;
- no private note send;
- no incoming echo send.

### 32.5. Synthetic provider adapter

Phase 0/1 dùng fake/synthetic adapter có counters:

```text
send_count
last_payload
provider_message_id
failure_mode
```

Support injected outcomes:

```text
success
429
500
timeout_before_accept
timeout_after_accept
unknown
```

Dùng để test outbox/retry mà không gửi khách thật.

### 32.6. E2E critical paths

#### E2E-01 Inbound text

```text
Provider event
→ Tinix durable persist
→ Chatwoot
→ visible conversation
```

Exactly one message.

#### E2E-02 Duplicate provider webhook

Same event x3.

Expected one Chatwoot message.

#### E2E-03 Human reply

```text
Chatwoot UI
→ API callback
→ Tinix outbox
→ provider
```

Exactly one provider send.

#### E2E-04 Private note

Expected zero provider send.

#### E2E-05 Incoming callback echo

Expected zero provider send.

#### E2E-06 Duplicate Chatwoot callback

Expected one outbox/provider send.

#### E2E-07 AI reply

```text
incoming
→ AI
→ Chatwoot outgoing
→ callback
→ outbox
→ provider
```

Exactly one reply.

#### E2E-08 Handoff race

Human takeover while AI generates.

Expected AI skipped.

#### E2E-09 Provider 429

Expected retry_wait/backoff; no loss.

#### E2E-10 Provider ambiguous result

Expected `unknown`; no blind resend.

#### E2E-11 Chatwoot unavailable

Provider event durable at Tinix; sync after recovery.

#### E2E-12 Tinix callback receiver outage

REST reconciliation finds missing outgoing.

#### E2E-13 Restart recovery

Pending event/outbox resumes.

#### E2E-14 Tenant isolation

Same external ID in two workspaces does not cross-link.

#### E2E-15 Attachment

Image/file inbound/outbound where supported.

#### E2E-16 Chatwoot status projection

PATCH/status update does not trigger resend.

### 32.7. Security tests

- invalid callback HMAC;
- stale timestamp;
- wrong secret source;
- wrong account/inbox;
- replay;
- payload size;
- cross-account access;
- token redaction.

### 32.8. Upgrade contract tests

Before Chatwoot version upgrade:

- run POC contract suite;
- compare callback payload assumptions;
- verify routes;
- verify HMAC;
- verify ContactInbox/source behavior;
- verify outgoing/private-note behavior;
- verify attachment path.

### 32.9. Acceptance principle

Không phase nào complete chỉ vì mock/unit tests pass nếu critical external contract chưa được POC/integration verify.

---

## 33. Performance Baseline

Không premature optimize nhưng đo tối thiểu:

- webhook ACK latency;
- normalize latency;
- Chatwoot sync latency;
- queue wait;
- end-to-end incoming visibility;
- AI first-token / reply completion;
- outbound provider latency.

Target ban đầu:

```text
Webhook ACK: nhanh, không chờ AI/Chatwoot chain dài
No synchronous AI call inside provider webhook handler
No provider webhook handler blocked by attachment download
```

---

## 34. Phase Execution Plan — V2

### Phase 0 — Repo Audit + Chatwoot POC

Deliver:

- repo architecture audit;
- map logical plan -> exact repo paths;
- selected queue/outbox strategy;
- DB migration plan;
- Chatwoot CE v4.18.0 POC;
- callback/account-webhook strategy;
- ContactInbox mapping;
- conversation reference policy;
- outbound predicate;
- delivery-state policy;
- reconciliation strategy;
- callback network/SafeFetch result.

Exit criteria: toàn bộ Architecture Gate tại Section 4.6 pass hoặc blocker được user quyết định.

**Phase 1 cannot start automatically if CRITICAL items fail.**

### Phase 1 — Inbox Core + Chatwoot Provider

Implement:

- `ChannelAdapter`;
- `ConversationProvider`;
- Tinix domain DTO/anti-corruption mapping;
- unified event/message models;
- channel connection persistence;
- ContactInbox/conversation/message mappings;
- provider event durable ingestion;
- Chatwoot callback durable ingestion;
- semantic idempotency;
- outbox;
- Tinix delivery state;
- reconciliation skeleton;
- ChatwootConversationProvider;
- synthetic provider adapter;
- feature flags;
- health/logging/correlation;
- unit/integration/E2E core tests.

Exit criteria:

- synthetic inbound -> Chatwoot exactly once;
- duplicate inbound -> no duplicate;
- human outgoing -> fake provider exactly once;
- private note -> zero send;
- incoming echo -> zero send;
- duplicate callback -> one send;
- Tinix restart recovery;
- Chatwoot callback outage reconciliation;
- tenant isolation pass;
- relevant tests/build pass.

### Phase 2 — Meta MVP

Before production code, verify current Meta API/version/permissions.

Implement:

- Meta connection lifecycle;
- webhook;
- inbound text/media;
- outbound;
- token lifecycle;
- provider idempotency/reconciliation as available.

Exit:

- real approved/test account E2E;
- duplicate webhook;
- human reply;
- AI reply;
- permission/token failure;
- provider 429;
- supported attachment;
- no known double-send.

### Phase 3 — AI/Human Handoff

Implement:

- conversation AI state;
- state version;
- Take Over;
- Resume AI;
- race protection;
- AI trigger;
- AI output through ConversationProvider;
- AI provenance.

Exit:

- handoff E2E;
- pending AI cancelled/skipped after takeover;
- no direct AI provider path;
- zero known double-send path.

### Phase 4 — Zalo OA

Capability spike using current official API first.

Implement only verified capability.

Exit:

- authorized OA connection;
- receive;
- human reply;
- AI reply;
- token refresh/reconnect;
- supported media;
- provider restrictions documented.

### Phase 5 — Native Tinix Inbox UI V1

Implement:

- conversations;
- detail;
- reply;
- internal note where supported;
- channel badge;
- Tinix delivery state;
- retry through Tinix outbox;
- AI state;
- Take Over/Resume;
- connection management;
- Tinix realtime relay/poll fallback.

Frontend -> Tinix backend only.

Exit:

- operator can perform standard flow without Chatwoot UI;
- UI never reports delivery stronger than Tinix evidence;
- degraded/unknown/retry states tested.

### Phase 6 — TikTok Shop

Only after capability/approval spike.

Exit:

- real authorized seller read/receive/send;
- event mechanism verified;
- token lifecycle;
- attachments if supported;
- limitations surfaced.

### Phase 7 — Shopee

Only after official messaging capability spike confirms access.

If blocked:

```text
BLOCKED_BY_PROVIDER
```

Do not scrape/browser-automate production chat.

Do not block stable Meta/Zalo release.

### Phase 8 — Business Tools / n8n

Add optional agent actions:

```text
lookup order
lookup customer
create/update CRM
email
internal notification
other business workflow
```

No dependency for plain message delivery.

### Phase 9 — Production Hardening

- load tests;
- callback/reconciliation stress;
- chaos/restart tests;
- backup/restore drill;
- secret rotation;
- dead-letter tooling;
- unknown-delivery tooling;
- monitoring/alerts;
- retention;
- security review;
- Chatwoot upgrade contract suite.

### Future Phase — Telegram Operator Bridge

**Không thuộc MVP hiện tại.**

Sau core ổn định có thể thêm Telegram làm operator interface duy nhất hàng ngày mà không đổi Channel Gateway/ConversationProvider architecture.

Không triển khai trong scope hiện tại trừ khi user mở phase riêng.

---

## 35. MVP Scope — V2 chốt

MVP core được coi là hoàn tất khi có:

```text
[ ] Chatwoot Community self-host integration
[ ] Exact Chatwoot version/image pinned after POC
[ ] ConversationProvider abstraction
[ ] ChannelAdapter abstraction
[ ] Tinix normalized domain DTO
[ ] provider durable webhook ingestion
[ ] Chatwoot callback durable ingestion
[ ] strict outbound predicate
[ ] private-note protection
[ ] incoming echo protection
[ ] semantic duplicate protection
[ ] ContactInbox/source mapping
[ ] conversation reference/thread policy
[ ] outbox + retry
[ ] Tinix authoritative delivery state
[ ] unknown-delivery handling
[ ] REST reconciliation
[ ] AI reply path
[ ] human reply path
[ ] Take Over / Resume AI
[ ] connection health
[ ] logs + correlation ID
[ ] basic channel settings UI
[ ] tenant isolation
[ ] callback HMAC/timestamp validation
[ ] tests + build pass
```

Channel milestone:

```text
[ ] Meta production/test E2E verified
```

Zalo là MVP+1 nếu provider approval/config kéo dài core release.

TikTok Shop/Shopee không block core MVP.

Native Inbox UI V1 có thể ship sau core operator validation nếu Chatwoot UI đang đủ để test backend, nhưng product release cho end users phải theo roadmap đã duyệt.

---

## 36. Non-goals của MVP

Không làm ngay:

- clone toàn bộ Chatwoot UI;
- full CRM;
- marketing campaign suite;
- broadcast engine;
- call center;
- voice calling;
- advanced SLA;
- full analytics BI;
- custom workflow builder;
- marketplace;
- full native Conversation Engine thay Chatwoot;
- browser automation để giả API Shopee/TikTok;
- unofficial scraping/session-cookie transport.

---

## 37. Migration Path khỏi Chatwoot — V2

### 37.1. Anti-corruption boundary

Ngay từ V1:

```text
ChannelAdapter
      │
      ▼
UnifiedEvent / UnifiedMessage
      │
      ▼
Tinix Domain
      │
      ▼
ConversationProvider
      │
      ├── ChatwootConversationProvider
      └── Future TinixConversationProvider
```

### 37.2. Chatwoot concepts không được leak

Map:

```text
Chatwoot Inbox
→ Tinix ChannelConnection integration ref

ContactInbox/source_id
→ Tinix ChannelIdentity

Chatwoot display_id
→ Tinix ConversationRef

message_type/private
→ Tinix direction/visibility/origin

assignee/team
→ Tinix operator assignment projection

labels/custom_attributes
→ Tinix tags/metadata abstraction
```

Frontend/AI dùng Tinix DTO.

### 37.3. Không đủ chỉ đổi class provider

Migration future cần:

- export contacts;
- export conversations;
- export full message history;
- export attachments/media;
- assignment/tags/support state;
- identity links;
- provider message links;
- unread policy;
- AI state;
- cutover watermark;
- dual reconciliation window.

### 37.4. Cutover plan future

1. implement `TinixConversationProvider`;
2. shadow-read/contract test;
3. export Chatwoot data;
4. import Tinix native store;
5. validate counts/content/attachments;
6. freeze/cutover window;
7. dual reconciliation;
8. switch provider;
9. preserve rollback path;
10. decommission Chatwoot only after audit.

ChannelAdapters không đổi.

AI/handoff business rules không đổi.

Native frontend không đổi nếu đã dùng Tinix facade.

---

## 38. Rollback Strategy

Mọi phase phải rollback được.

### Core feature flag rollback

Disable:

```text
tinix_inbox_enabled=false
```

không ảnh hưởng chức năng Tinix hiện tại.

### Per-channel rollback

```text
tinix_inbox_zalo_enabled=false
```

không ảnh hưởng Meta.

### DB

Migration destructive không được đưa vào cùng release với feature mới.

Ưu tiên:

1. additive schema;
2. code rollout;
3. data backfill;
4. optional cleanup ở release sau.

---

## 39. Provider Capability Matrix

Codex phải duy trì matrix này dựa trên test thực tế, không chỉ tài liệu.

| Capability | Meta | Zalo OA | TikTok Shop | Shopee |
|---|---|---|---|---|
| Connect account | Verify | Verify | Verify | Verify |
| Incoming text | Verify | Verify | Verify | Capability spike |
| Outgoing text | Verify | Verify | Verify | Capability spike |
| Images | Verify | Verify | Verify | Capability spike |
| Files | Verify | Verify | Verify | Capability spike |
| Delivery receipt | Verify | Verify | Verify | Capability spike |
| Read receipt | Verify | Verify | Verify | Capability spike |
| Typing | Verify | Verify | Verify | Capability spike |
| OAuth/token refresh | Verify | Verify | Verify | Verify |
| Realtime webhook | Verify | Verify | Verify | Capability spike |
| App review/approval | Verify | Verify | Required? verify | Verify |
| Market restrictions | Verify | Verify | Verify | Verify |

`Verify` nghĩa là Codex phải kiểm tra current official docs + actual account/test environment trước khi đánh dấu supported.

---

## 40. Coding Quality Gate

Không phase nào được coi là xong chỉ vì code compile.

Mỗi phase report:

```text
IMPLEMENTED
CHANGED FILES
MIGRATIONS
CONFIG
TESTS
BUILD
E2E
KNOWN LIMITATIONS
PROVIDER BLOCKERS
SECURITY NOTES
ROLLBACK
NEXT STEP
```

Quality gate:

```text
[ ] lint
[ ] typecheck
[ ] relevant unit tests
[ ] integration tests
[ ] build
[ ] existing regression suite
[ ] no new unexplained failures
[ ] secret scan/manual check
[ ] no TODO that changes correctness silently
```

Nếu full suite đã có baseline failures trước Tinix Inbox, Codex phải tách:

```text
pre-existing failure
new failure
```

không được coi mọi failure là do feature mới hoặc bỏ qua vô điều kiện.

---

## 41. Codex Working Rules

Codex phải làm theo thứ tự:

1. Đọc file này toàn bộ.
2. Audit repo.
3. Báo cáo kiến trúc thực tế và các điều chỉnh path/dependency.
4. Không bắt đầu tất cả channel cùng lúc.
5. Hoàn thành Core + Synthetic Adapter.
6. Hoàn thành Chatwoot POC.
7. Hoàn thành Meta E2E.
8. Hoàn thành handoff.
9. Sau đó mới Zalo.
10. TikTok/Shopee phải qua capability gate.

Khi gặp provider blocker:

```text
DO NOT:
- fake success;
- create mock production connector;
- scrape UI;
- use undocumented session cookie hacks.

DO:
- isolate blocker;
- keep adapter contract;
- document exact permission/API missing;
- continue work không phụ thuộc blocker.
```

---

## 42. First Codex Task — Phase 0 V2

Dùng task sau sau khi các file đã nằm trong repo thật:

```text
Read these files completely before making implementation changes:
- AGENTS.md
- PLAN_TinixInbox.md
- RESEARCH_Chatwoot.md
- UI_UX.md only if UI is touched

Execute Phase 0 of PLAN_TinixInbox.md only.

Do NOT implement production Meta/Zalo/TikTok/Shopee connectors.
Do NOT begin Phase 1 unless the Architecture Gate passes.

Tasks:

1. Audit the actual Tinix repository:
   - frontend/backend stack
   - DB/ORM/migrations
   - queue/background jobs/outbox
   - auth/workspace/tenant model
   - config/secrets
   - logging/errors
   - feature flags
   - realtime
   - object storage
   - AI/model/tool abstractions
   - test/build/restart/deploy conventions

2. Map the logical Tinix Inbox architecture onto exact repository paths.
   Reuse existing primitives before adding dependencies.

3. Set up or document the minimal isolated Chatwoot Community v4.18.0 POC.
   Verify the actual CE image tag and digest; do not use latest.

4. Run the Chatwoot POC matrix from PLAN_TinixInbox.md:
   - Account/API Inbox bootstrap
   - Contact/ContactInbox mapping
   - same external user across two inboxes
   - conversation display/reference behavior
   - incoming message
   - human outgoing
   - private note
   - activity/template policy
   - AI outgoing path with fake adapter
   - duplicate/reordered callback
   - callback receiver failure
   - REST reconciliation
   - restart recovery
   - delivery status behavior
   - attachment basic flow
   - HMAC/timestamp/replay
   - cross-account access
   - SafeFetch/network callback topology

5. Use a synthetic/fake provider adapter only.
   Record provider send count so duplicate-send behavior is measurable.

6. Resolve and report all V2 architecture gates:
   - API Inbox callback vs account webhook feed strategy
   - strict outbound predicate
   - ContactInbox/source mapping
   - conversation thread/reference policy
   - Tinix-authoritative delivery state
   - outbox uniqueness
   - REST reconciliation
   - callback topology/security

7. Run relevant existing Tinix tests/build and record baseline failures separately.

Do not silently modify architecture if a POC result contradicts the plan.
Report the conflict and propose an explicit plan amendment.

Final report format:

STATUS:
READY / READY WITH LIMITATIONS / BLOCKED

REPOSITORY FINDINGS:
...

CHATWOOT VERSION / IMAGE / DIGEST:
...

POC RESULTS:
POC-01 ...
...

ARCHITECTURE GATE:
PASS / FAIL per item

PLAN DEVIATIONS:
...

EXACT PHASE-1 FILES:
...

DB/MIGRATIONS:
...

NEW DEPENDENCIES:
...

TEST/BUILD BASELINE:
...

BLOCKERS:
...

RECOMMENDED PHASE-1 COMMAND:
...

Stop after Phase 0 for review.
```

---

## 43. Phase 1 Codex Task — chỉ sau Architecture Gate PASS

```text
Read:
- AGENTS.md
- PLAN_TinixInbox.md
- RESEARCH_Chatwoot.md
- the approved Phase 0 report

Implement Phase 1 only using the repository-specific architecture approved in Phase 0.

Scope:

1. ChannelAdapter abstraction.
2. ConversationProvider abstraction and Tinix anti-corruption DTO.
3. Unified message/event/capability/delivery models.
4. Channel connection persistence.
5. Composite ContactInbox/source mapping.
6. Conversation link/thread-key persistence.
7. Provider webhook durable ingestion.
8. Chatwoot API Inbox callback durable ingestion.
9. HMAC/timestamp/replay validation.
10. Semantic callback deduplication.
11. Strict outbound predicate:
    - message_created
    - mapped account/inbox
    - outgoing
    - private=false
    - supported policy/type
    - unique Chatwoot message ID
12. Outbox + durable retry.
13. Tinix-authoritative delivery state.
14. Unknown state.
15. REST reconciliation skeleton.
16. ChatwootConversationProvider.
17. Synthetic provider adapter.
18. Feature flags.
19. Health/metrics/logging/correlation.
20. Unit/integration/E2E core tests.

Constraints:

- Do not implement production Meta/Zalo/TikTok/Shopee yet.
- Do not fork Chatwoot.
- Do not read/write Chatwoot DB directly.
- Do not expose provider/Chatwoot secrets to frontend.
- Do not put n8n in message critical path.
- Do not let AI call provider send directly.
- Chatwoot default sent status is not provider truth.
- Private notes must never reach provider.
- Incoming callback echoes must never reach provider.
- message_updated must never create a new outbox send.
- Provider retry is owned by Tinix outbox.
- Preserve existing Tinix behavior.
- No unrelated refactors.

Acceptance:

[ ] synthetic inbound reaches Chatwoot exactly once
[ ] duplicate synthetic inbound does not duplicate
[ ] Chatwoot human outgoing reaches synthetic provider exactly once
[ ] duplicate Chatwoot callback still sends exactly once
[ ] private note sends zero provider messages
[ ] incoming callback echo sends zero provider messages
[ ] status update sends zero provider messages
[ ] outbox retry survives Tinix restart
[ ] callback outage can be recovered through reconciliation
[ ] ambiguous provider outcome becomes unknown, not blind resend
[ ] ContactInbox identity isolation passes
[ ] tenant/workspace isolation passes
[ ] relevant tests pass
[ ] build passes or only documented pre-existing baseline failures remain

Completion report:

STATUS
IMPLEMENTED
CHANGED FILES
MIGRATIONS
CONFIG / ENV
TEST RESULTS
BUILD RESULT
E2E RESULTS
CALLBACK/RECONCILIATION RESULTS
KNOWN LIMITATIONS
SECURITY NOTES
ROLLBACK
NEXT PHASE COMMAND
```

---

## 44. Release Criteria

Tinix Inbox không production-ready cho một channel cho đến khi:

```text
[ ] Official API access verified
[ ] Required permissions approved
[ ] Connect/reconnect tested
[ ] Webhook authenticity verified
[ ] Inbound E2E tested
[ ] Outbound E2E tested
[ ] Duplicate delivery tested
[ ] Retry tested
[ ] Token expiry/revoke tested
[ ] Chatwoot outage tested
[ ] App restart tested
[ ] AI reply tested
[ ] Human reply tested
[ ] Handoff race tested
[ ] Attachment types documented
[ ] Known provider limitations surfaced in UI/docs
[ ] Monitoring available
[ ] Rollback verified
```

---

## 45. Architecture Decision Summary — V2

### ADR-01 — Tinix owns Channel Gateway
Provider credentials, connection lifecycle and ChannelAdapters belong to Tinix.

### ADR-02 — Chatwoot CE is ConversationProvider V1
Research baseline validated on Chatwoot v4.18.0 with POC required before Phase 1.

### ADR-03 — One API Inbox per connected provider account
Default V1 strategy. Scale/inbox-count limit remains subject to load testing.

### ADR-04 — Do not deeply fork Chatwoot
Use supported Application API, API Inbox callback and account webhook.

### ADR-05 — Application API server-to-server
Tinix backend uses Application API with controlled service-user credentials. Frontend never gets Chatwoot token.

### ADR-06 — API Inbox callback is preferred message-event feed
Account webhook is used mainly for contact/conversation events. If both feeds contain the same semantic event, Tinix deduplicates.

### ADR-07 — Callback is a signal, not a durable queue
Tinix durable-persist + ACK + reconciliation is mandatory.

### ADR-08 — Single outbound path

```text
Human / AI
→ Chatwoot outgoing
→ API Inbox callback
→ Tinix durable receipt
→ strict predicate
→ Tinix outbox
→ ChannelAdapter
→ provider
```

### ADR-09 — Private notes never leave Chatwoot/Tinix
`private=true` is a hard no-send condition.

### ADR-10 — Tinix owns idempotency
Chatwoot message source IDs/statuses are not sufficient to guarantee exactly-once provider send.

### ADR-11 — Tinix owns provider delivery state
Chatwoot `sent` is not provider acceptance. `queued/sending/provider_accepted/delivered/read/failed/unknown` live in Tinix.

### ADR-12 — Unknown beats blind resend
When provider acceptance is ambiguous and no idempotency/query exists, mark `unknown`.

### ADR-13 — ContactInbox mapping is first-class
Persist Chatwoot account/inbox/contact/contact-inbox/source refs and namespace external identities.

### ADR-14 — Conversation policy is provider-aware
Do not assume every provider exposes a stable external thread ID.

### ADR-15 — Reconciliation is production requirement
REST sweep/window/watermark is needed because callbacks may be missed.

### ADR-16 — Hybrid attachment strategy
Tinix owns durable transport copy/reference where needed; Chatwoot Active Storage supports operator experience.

### ADR-17 — Tinix owns product RBAC/audit
Do not depend on Enterprise custom roles/audit logs for MVP.

### ADR-18 — Native UI calls Tinix backend
No direct Chatwoot frontend dependency; Tinix relays realtime.

### ADR-19 — No direct Chatwoot DB access
Supported APIs/callbacks only.

### ADR-20 — Exact Chatwoot version/image pin
No production `latest`; staging contract tests before upgrade.

### ADR-21 — n8n is optional automation
Never required for ordinary message transport.

### ADR-22 — Chatwoot must remain replaceable
Domain DTO + ConversationProvider anti-corruption layer + future data migration path.

---

## 46. Research và nguồn kỹ thuật

### 46.1. Source of technical evidence

Trước Phase 0/1, Codex phải đọc:

```text
RESEARCH_Chatwoot.md
```

Research baseline:

```text
Chatwoot v4.18.0
release: 2026-09-18
commit:
9f920b549c14491a4e587687a3eed5d21c6ccc7d
```

Research đã xác minh bằng docs/source:

- Community vs Enterprise boundary;
- API Inbox/API Channel;
- Application API;
- Contact/ContactInbox;
- conversation/message behavior;
- API Inbox callback;
- account webhook;
- HMAC/timestamp signing;
- outgoing/private-note behavior;
- callback reliability limitations;
- message status semantics;
- attachment/Active Storage;
- ActionCable;
- deployment/upgrade behavior;
- SafeFetch private-network policy.

POC vẫn là requirement cho runtime behavior.

### 46.2. Chatwoot official starting points

API Inbox:
https://www.chatwoot.com/hc/user-guide/articles/1677839703-how-to-create-an-api-channel-inbox

Webhooks:
https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks

API docs:
https://developers.chatwoot.com/

Self-host deployment:
https://developers.chatwoot.com/self-hosted/

Repository/release:
https://github.com/chatwoot/chatwoot

### 46.3. Provider sources

Codex phải dùng current official docs tại thời điểm từng provider phase.

Meta:
- Messenger Platform
- Instagram Messaging
- Webhooks
- App Review / permissions

Zalo:
https://developers.zalo.me/

TikTok Shop:
https://partner.tiktokshop.com/

Shopee:
current official Shopee Open Platform docs/account permissions.

Không dùng stale assumptions từ plan/research Chatwoot để suy ra provider capability.

### 46.4. n8n

Trước khi expose/embed n8n cho external Tinix customers, review current commercial/licensing terms.

V1 chỉ coi n8n là internal/optional automation integration.

---

## 47. Definition of Success — V2

Tinix Inbox đạt mục tiêu kiến trúc khi:

### Provider independence

Có thể thêm/thay:

```text
Meta
Zalo
TikTok Shop
Shopee
future provider
```

mà:

```text
ConversationProvider
Agent Runtime
Native UI
```

không cần hiểu provider-specific raw payload.

### Conversation-backend independence

Có thể thay:

```text
ChatwootConversationProvider
```

bằng:

```text
TinixConversationProvider
```

mà:

```text
ChannelAdapters
AI business logic
Native Tinix UI
```

không phải viết lại.

### Delivery correctness

Mỗi outbound message có:

```text
stable Tinix identity
one outbox record
known/unknown provider outcome
auditable attempts
no private-note leak
no incoming echo resend
```

### Recovery

System có thể recover sau:

```text
Tinix restart
Chatwoot restart
callback outage
provider 429/5xx
worker delay
```

mà không phụ thuộc memory-only state.

### Security

Không cross-tenant mapping.
Không expose secrets frontend.
Callback/webhook verified.
Provider access follows least privilege available.

### Operational truth

```text
Provider changes ≠ Core rewrite
Conversation backend changes ≠ Channel rewrite
AI model changes ≠ Messaging rewrite
Automation engine changes ≠ Conversation rewrite
Callback loss ≠ Message loss
Chatwoot "sent" ≠ Fake provider delivery truth
```

Đây là Definition of Success của V2.

---

## 48. Final Target — V2

```text
                          Tinix Inbox
                              │
                ┌─────────────┴──────────────┐
                │                            │
        Channel Connections           Native Inbox UI
                │                            │
                ▼                            ▼
       Tinix Channel Gateway        Tinix Backend Facade
                │                            │
                ▼                            │
       Durable Provider Events               │
                │                            │
                └─────────────┬──────────────┘
                              ▼
                     Unified Inbox Domain
                              │
             ┌────────────────┼─────────────────┐
             ▼                ▼                 ▼
      Conversation        Tinix Agent      Delivery/Outbox
        Provider            Runtime        + Reconciliation
             │                │                 │
             ▼                ▼                 ▼
       Chatwoot CE V1     RAG/Models        ChannelAdapter
             │             / Tools               │
             │                │                   ▼
             │                ▼                Provider
             │             n8n / APIs
             │              optional
             │
             ├─ API Inbox callback → Tinix durable receipt
             └─ Account webhook → contact/conversation signals
```

**V1 conversation infrastructure:** Chatwoot CE, research baseline v4.18.0.  
**Production gate:** Phase 0 POC + Architecture Gate.  
**Channels:** Tinix-owned.  
**Provider delivery truth:** Tinix-owned.  
**AI/handoff:** Tinix-owned.  
**Callback durability/reconciliation:** Tinix-owned.  
**Automation:** pluggable.  
**Native UI:** Tinix backend facade.  
**Chatwoot DB:** never accessed directly by production Tinix code.  
**Pancake:** no required dependency.  
**Telegram Operator Bridge:** future optional extension, not MVP scope.

---

