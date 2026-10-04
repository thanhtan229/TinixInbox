# Kịch Bản Thực Hành & Kiểm Thử — Tinix Inbox V2

> Tài liệu này cung cấp các bài thực hành từng bước (step-by-step) giúp bạn kiểm thử và làm chủ toàn bộ tính năng cốt lõi của hệ thống Tinix Inbox V2: từ phản hồi thông minh của AI Agent, tra cứu vận đơn qua Function Calling, chuyển giao quyền kiểm soát (Human Takeover), đến kiểm tra đường truyền Single Outbound Path và sao lưu phục hồi dữ liệu.

---

## 0. Chuẩn Bị Môi Trường Trước Khi Thực Hành

Trước khi bắt đầu, hãy đảm bảo hệ thống đang hoạt động bình thường:

1. **Khởi động Docker Containers (Chatwoot & Relay):**
   ```bash
   docker compose -f poc/chatwoot-v418/compose.yaml up -d
   ```
2. **Khởi động Tinix Inbox Server:**
   ```bash
   npm start
   ```
   *(Hoặc nhấp đúp chạy file [`START.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/START.bat))*.
3. **Mở 2 tab trình duyệt song song:**
   * **Tab 1 — Tinix Web UI:** Mở `http://127.0.0.1:3182`
   * **Tab 2 — Chatwoot Dashboard:** Mở `http://127.0.0.1:3180` *(Đăng nhập: `poc-admin@tinix.test` / `TinixTestPoc2026!`)*

---

## Kịch Bản 1: Khách Nhắn Tin Inbound & AI Agent Phản Hồi Tự Nhiên

### Mục tiêu:
Kiểm chứng luồng nhận tin từ khách hàng, AI Gemini 2.5 Flash trả lời tự động bằng tiếng Việt tự nhiên, thân thiện và không có văn phong máy móc rập khuôn.

### Các bước thực hiện:
1. Mở một cửa sổ PowerShell mới tại thư mục dự án.
2. Gửi một tin nhắn giả lập từ khách hàng qua kênh Synthetic Channel:
   ```powershell
   node --input-type=module -e "
     const payload = {
       event_id: 'evt-' + Date.now(),
       connection_id: 'conn-chatwoot-1',
       sender_id: 'cust-888',
       user_name: 'Nguyen Van Tuan',
       conversation_id: 'conv-888',
       message_id: 'msg-' + Date.now(),
       text: 'Shop ơi shop có hỗ trợ ship COD toàn quốc không ạ?',
       timestamp: Date.now()
     };
     const res = await fetch('http://127.0.0.1:3182/webhooks/channels/synthetic/conn-chatwoot-1', {
       method: 'POST',
       headers: {
         'content-type': 'application/json',
         'x-synthetic-signature': 'secret-secret'
       },
       body: JSON.stringify(payload)
     });
     console.log('Webhook Status:', res.status, await res.json());
   "
   ```
3. Quan sát giao diện **Tinix Web UI (`http://127.0.0.1:3182`)**:
   * Tin nhắn của khách hàng *"Shop ơi shop có hỗ trợ ship COD toàn quốc không ạ?"* xuất hiện ngay tức thì qua Realtime SSE.
   * Khoảng 1 - 2 giây sau, tin nhắn trả lời của AI xuất hiện với huy hiệu màu xanh tím:
     > *"Chào bạn, Tinix có hỗ trợ ship COD toàn quốc nha. Bạn cứ yên tâm đặt hàng nha."*
4. Chuyển sang tab **Chatwoot Dashboard (`http://127.0.0.1:3180`)**:
   * Mở hội thoại số 7 (Conversation #7), xác nhận tin nhắn của khách và tin nhắn của AI đều được đồng bộ đầy đủ trên timeline.

---

## Kịch Bản 2: AI Tự Động Tra Cứu Vận Đơn Qua Function Calling

### Mục tiêu:
Kiểm chứng khả năng nhận diện ý định và gọi công cụ kinh doanh (Phase 8 Business Tools - `lookup_order`) của Gemini 2.5 Flash.

### Các bước thực hiện:
1. Đảm bảo biến `BUSINESS_TOOLS_DEMO_MODE=true` đã được cấu hình trong file [`.env`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/.env).
2. Khách hàng gửi tin nhắn yêu cầu tra cứu mã đơn hàng cụ thể:
   ```powershell
   node --input-type=module -e "
     const payload = {
       event_id: 'evt-' + Date.now(),
       connection_id: 'conn-chatwoot-1',
       sender_id: 'cust-888',
       user_name: 'Nguyen Van Tuan',
       conversation_id: 'conv-888',
       message_id: 'msg-order-' + Date.now(),
       text: 'Shop kiểm tra giúp mình mã đơn DH12345 với nha!',
       timestamp: Date.now()
     };
     await fetch('http://127.0.0.1:3182/webhooks/channels/synthetic/conn-chatwoot-1', {
       method: 'POST',
       headers: { 'content-type': 'application/json', 'x-synthetic-signature': 'secret-secret' },
       body: JSON.stringify(payload)
     });
     console.log('Đã gửi yêu cầu tra cứu đơn DH12345!');
   "
   ```
3. Quan sát kết quả phản hồi trên **Tinix Web UI**:
   * Gemini tự động kích hoạt tool `lookup_order` với tham số `orderId: "DH12345"`.
   * AI phản hồi trực tiếp với đầy đủ dữ liệu thực tế:
     > *"Đơn DH12345 của bạn đang trên đường giao rồi nha. Dự kiến sẽ tới tay bạn trong 24-48 giờ tới đó."*
4. Kiểm tra dữ liệu kiểm toán **AI Provenance** lưu trong CSDL:
   ```powershell
   node --input-type=module -e "
     import { DatabaseSync } from 'node:sqlite';
     const db = new DatabaseSync('./data/tinix_inbox.db');
     const item = db.prepare('SELECT metadata FROM message_links WHERE origin=\"ai\" ORDER BY created_at DESC LIMIT 1').get();
     console.log(JSON.parse(item.metadata));
   "
   ```
   * **Kết quả hiển thị:**
     ```json
     {
       "aiProvenance": {
         "model": "gemini-2.5-flash",
         "durationMs": 3575,
         "toolUsed": "lookup_order"
       }
     }
     ```

---

## Kịch Bản 3: Chuyển Giao Quyền Kiểm Soát (Human Takeover & Handoff Policy)

### Mục tiêu:
Kiểm chứng khả năng nhân viên can thiệp vào cuộc trò chuyện, dừng AI tức thời và ngăn chặn tình trạng trả lời trùng chéo (Race Condition).

### Các bước thực hiện:
1. Mở **Tinix Web UI (`http://127.0.0.1:3182`)**, chọn hội thoại số 7.
2. Tại cột bên phải, tìm mục **Chế độ phản hồi (Takeover)**:
   * Nhấp chọn nút **"Human Agent"** (hoặc gạt công tắc sang trạng thái Người thật tiếp quản).
   * Huy hiệu trạng thái trên cuộc hội thoại chuyển thành màu cam: `Human Takeover Active`.
3. Giả lập khách hàng gửi thêm một câu hỏi mới:
   ```powershell
   node --input-type=module -e "
     const payload = {
       event_id: 'evt-' + Date.now(),
       connection_id: 'conn-chatwoot-1',
       sender_id: 'cust-888',
       user_name: 'Nguyen Van Tuan',
       conversation_id: 'conv-888',
       message_id: 'msg-human-check-' + Date.now(),
       text: 'Shop ơi có người ở đây không, tư vấn riêng cho mình với?',
       timestamp: Date.now()
     };
     await fetch('http://127.0.0.1:3182/webhooks/channels/synthetic/conn-chatwoot-1', {
       method: 'POST',
       headers: { 'content-type': 'application/json', 'x-synthetic-signature': 'secret-secret' },
       body: JSON.stringify(payload)
     });
   "
   ```
4. Quan sát:
   * **AI hoàn toàn im lặng** và không gửi bất kỳ phản hồi tự động nào.
   * Nhân viên nhập tin nhắn phản hồi trực tiếp từ khung chat bên dưới giao diện Tinix UI:
     > *"Dạ chào bạn, mình là nhân viên hỗ trợ trực tiếp. Mình có thể giúp gì cho bạn ạ?"*
   * Bấm **Gửi tin nhắn**. Tin nhắn đi qua Chatwoot và được gửi thẳng tới khách hàng.
5. Khi giải quyết xong, nhân viên nhấp chọn lại **"AI Agent"**:
   * Hệ thống khôi phục quyền cho AI tiếp tục trả lời các tin nhắn tiếp theo của khách.

---

## Kịch Bản 4: Kiểm Thử Đường Dẫn Single Outbound Path & Theo Dõi Trạng Thái

### Mục tiêu:
Xác nhận rằng tin nhắn outbound không bao giờ đi đường vòng mà luôn tuân thủ Single Outbound Path: ghi nhận tại Chatwoot ➔ Callback về Tinix ➔ Xếp hàng Outbox ➔ Gửi qua Adapter nhà mạng.

### Các bước thực hiện:
1. Gửi một tin nhắn nhân viên từ Chatwoot Dashboard hoặc từ Tinix Web UI.
2. Kiểm tra hàng đợi Outbox trong CSDL SQLite:
   ```powershell
   node --input-type=module -e "
     import { DatabaseSync } from 'node:sqlite';
     const db = new DatabaseSync('./data/tinix_inbox.db');
     const outbox = db.prepare('SELECT id, state, provider_message_id, created_at, sent_at FROM outbox_messages ORDER BY created_at DESC LIMIT 3').all();
     console.log(outbox);
   "
   ```
3. Quan sát các trường dữ liệu:
   * `state`: Chuyển từ `pending` ➔ `sending` ➔ `provider_accepted`.
   * `provider_message_id`: Có mã định danh do nhà mạng cấp (ví dụ: `synth-msg-xxxx`).
   * `sent_at`: Ghi dấu thời gian gửi đi chính xác.
4. Trên giao diện Web UI, huy hiệu bên cạnh tin nhắn sẽ hiển thị trạng thái `Accepted` màu xanh lá cây theo thời gian thực.

---

## Kịch Bản 5: Xử Lý Lỗi Mạng & Thao Tác Redrive Tin Nhắn Outbox

### Mục tiêu:
Kiểm nghiệm cơ chế tự động thử lại khi nhà mạng bị lỗi tạm thời (HTTP 429, 500, timeout) và nút bấm **Redrive** phục hồi tin nhắn từ giao diện.

### Các bước thực hiện:
1. Xem danh sách các tin nhắn thất bại trong CSDL hoặc trên giao diện Web UI:
   ```powershell
   node --input-type=module -e "
     import { DatabaseSync } from 'node:sqlite';
     const db = new DatabaseSync('./data/tinix_inbox.db');
     const deadLetters = db.prepare('SELECT id, chatwoot_message_id, state, last_error FROM outbox_messages WHERE state IN (\"failed\", \"unknown\")').all();
     console.log('Tin nhắn lỗi / Dead letter:', deadLetters);
   "
   ```
2. Thực hiện lệnh Redrive toàn bộ tin nhắn lỗi qua API:
   ```powershell
   node --input-type=module -e "
     const res = await fetch('http://127.0.0.1:3182/api/outbox/redrive', { method: 'POST' });
     console.log('Kết quả Redrive:', await res.json());
   "
   ```
3. Outbox Worker sẽ tự động bốc lại các tin nhắn này và gửi lại cho nhà mạng ngay trong chu kỳ tiếp theo (mỗi 2 giây).

---

## Kịch Bản 6: Sao Lưu & Phục Hồi Cơ Sở Dữ Liệu An Toàn

### Mục tiêu:
Đảm bảo an toàn dữ liệu khách hàng và lịch sử hội thoại trước các sự cố rủi ro.

### Các bước thực hiện:
1. **Chạy script sao lưu:**
   Mở terminal và chạy file [`BACKUP.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/BACKUP.bat):
   ```cmd
   .\BACKUP.bat
   ```
   Hệ thống sẽ snapshot toàn bộ dữ liệu đang lưu trong bộ nhớ WAL của SQLite vào thư mục `backups/inbox-backup-[timestamp].db` và kiểm tra tính toàn vẹn (Integrity Check).
2. **Kiểm tra file sao lưu:**
   ```powershell
   Get-ChildItem backups/
   ```
3. **Thực hành phục hồi dữ liệu:**
   Khi cần khôi phục lại trạng thái trước đó, chạy file [`RESTORE.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/RESTORE.bat):
   ```cmd
   .\RESTORE.bat
   ```
   Hệ thống sẽ tự động sao lưu bản snapshot an toàn hiện tại (`tinix_inbox.db.pre_restore`), sau đó khôi phục dữ liệu từ bản backup đã chọn.

---

## Tổng Kết Đánh Giá

Sau khi hoàn thành 6 kịch bản trên:
* [x] AI Agent trả lời tự nhiên, thân thiện và linh hoạt.
* [x] Function Calling hoạt động chính xác với thông tin đơn hàng thực tế.
* [x] Cơ chế Human Takeover bảo vệ tuyệt đối không để AI tranh trả lời với nhân viên.
* [x] Single Outbound Path đảm bảo tính nhất quán trên toàn hệ thống.
* [x] Cơ sở dữ liệu và hạ tầng sẵn sàng cho vận hành thực tế.
