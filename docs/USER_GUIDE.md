# Hướng Dẫn Sử Dụng Chi Tiết — Tinix Inbox V2

> **Tinix Inbox** là hạ tầng hội thoại đa kênh (Omnichannel Messaging Infrastructure) hợp nhất các kênh nhắn tin (Facebook Messenger, Instagram, Zalo OA, TikTok Shop, Shopee, Synthetic Channel) về một đầu mối tập trung, tích hợp cùng **Chatwoot CE v4.18.0** và **Tinix AI Agent (Google Gemini 2.5 Flash)** với cơ chế Single Outbound Path an toàn và giao diện Realtime Web UI.

---

## 1. Tổng Quan Kiến Trúc Hệ Thống

```mermaid
flowchart TD
    subgraph Channels["Các Kênh Nhắn Tin (Channels)"]
        CH1["Meta / Messenger"]
        CH2["Zalo OA"]
        CH3["TikTok Shop"]
        CH4["Shopee"]
        CH5["Synthetic / Test Channel"]
    end

    subgraph TinixInbox["Tinix Inbox Core (Port 3182)"]
        WH["Webhook Ingestion Controller"]
        INB["Inbound Service"]
        ROUTER["Inbox Agent Router"]
        AI["Gemini 2.5 Flash + Tools"]
        OUT["Outbound Service"]
        BOX["Outbox Engine (SQLite WAL)"]
        SSE["EventBus (Realtime SSE)"]
        UI["Native Web UI"]
    end

    subgraph Chatwoot["Chatwoot CE v4.18.0 (Port 3180)"]
        CW_API["API Channel / Webhooks"]
        CW_DASH["Chatwoot Agent Dashboard"]
    end

    Channels -->|Inbound Webhook| WH
    WH --> INB
    INB -->|REST API| CW_API
    INB --> ROUTER
    ROUTER -->|Function Calling| AI
    AI -->|Outgoing Reply| CW_API
    CW_API -->|Webhook Callback| OUT
    OUT --> BOX
    BOX -->|Adapter.sendMessage| Channels
    INB -.->|Broadcast| SSE
    BOX -.->|Broadcast| SSE
    SSE -.-> UI
    CW_DASH <--> CW_API
```

### Các nguyên tắc kiến trúc cốt lõi:
1. **Single Outbound Path:** Mọi tin nhắn phản hồi (dù do Nhân viên hay do AI tạo ra) đều bắt buộc đi qua Chatwoot ➔ nhận callback ➔ ghi vào Tinix Outbox ➔ Provider Adapter gửi đi. Tuyệt đối không gửi thẳng từ AI ra nhà mạng để tránh lệch lịch sử và trùng lặp.
2. **AI & Human Handoff:** Đảm bảo Nhân viên và AI không bao giờ cùng lúc trả lời một khách hàng. Khi nhân viên tiếp quản (Takeover), AI tự động dừng trả lời ngay lập tức.
3. **Idempotency & Deduplication:** Mọi tin nhắn vào/ra đều có khóa duy nhất composite key `workspace_id + channel_connection_id + external_message_id`, ngăn chặn 100% duplicate tin nhắn từ webhook retry.
4. **Chatwoot Thay Thế Được:** Toàn bộ tương tác Chatwoot nằm sau abstraction [`ConversationProvider`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/src/core/conversation-provider.ts).

---

## 2. Yêu Cầu Hệ Thống & Cài Đặt

### 2.1. Yêu cầu môi trường
* **Hệ điều hành:** Windows 10/11, Linux hoặc macOS.
* **Node.js:** Phiên bản `v22.0.0` trở lên (Khuyến nghị `v24.18.0`+ để hỗ trợ sẵn `--experimental-strip-types` và `node:sqlite`).
* **Docker & Docker Compose:** Để chạy cụm Chatwoot CE v4.18.0.
* **Google Gemini API Key:** Dành cho AI Agent (mô hình `gemini-2.5-flash`).

### 2.2. Cấu hình biến môi trường (`.env`)
Tạo hoặc kiểm tra file [`.env`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/.env) tại thư mục gốc của dự án:

```env
# Cấu hình Tinix Inbox Server
PORT=3182
HOST=127.0.0.1
NODE_ENV=development

# Chatwoot CE kết nối
CHATWOOT_BASE_URL=http://127.0.0.1:3180
CHATWOOT_API_TOKEN=yi43oQcmqyp7MmGsXoDs2tx1
CHATWOOT_ACCOUNT_ID=1

# Trí tuệ nhân tạo Gemini
GEMINI_API_KEY=AIzaSyB0Awmbsx9G6t_ZjNpDpEOfkjFGtVZU8_8
GEMINI_MODEL=gemini-2.5-flash

# Kích hoạt Business Tools (Demo Mode tra cứu đơn hàng, CRM Lead)
BUSINESS_TOOLS_DEMO_MODE=true

# Kết nối n8n Workflow (Tùy chọn)
N8N_WEBHOOK_BASE_URL=
N8N_WEBHOOK_AUTH_TOKEN=
```

---

## 3. Khởi Động & Vận Hành Hệ Thống

Dự án cung cấp sẵn các file batch script (.bat) trên Windows để thao tác nhanh chóng:

| File Script | Chức Năng | Chi Tiết |
| :--- | :--- | :--- |
| [`START.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/START.bat) | **Khởi động Tinix Inbox** | Kiểm tra môi trường, chạy migrations và bật server tại port 3182. |
| [`STOP.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/STOP.bat) | **Dừng Tinix Inbox** | Giải phóng cổng 3182 và tắt tiến trình node an toàn. |
| [`BUILD.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/BUILD.bat) | **Kiểm tra mã nguồn** | Chạy `npm run typecheck` và toàn bộ bộ test tự động (75 test). |
| [`BACKUP.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/BACKUP.bat) | **Sao lưu CSDL** | Snapshot SQLite WAL an toàn không gián đoạn dịch vụ. |
| [`RESTORE.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/RESTORE.bat) | **Phục hồi CSDL** | Khôi phục bản sao lưu với cơ chế bảo vệ pre-restore copy. |
| [`TUNNEL.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/TUNNEL.bat) | **Mở Public Tunnel** | Mở đường hầm Cloudflare HTTPS cho Chatwoot bên ngoài gọi về. |

### Bước 1: Khởi động Chatwoot Stack (Docker)
Mở terminal tại thư mục dự án và chạy:
```bash
docker compose -f poc/chatwoot-v418/compose.yaml up -d
```
Cụm Chatwoot sẽ khởi động các dịch vụ:
* Web Dashboard: `http://127.0.0.1:3180`
* PostgreSQL 16 (`pgvector`)
* Redis 7
* Sidekiq Worker
* Callback Relay Container (`tinix-chatwoot-v418-poc-callback-receiver-1` trên port 3181)

### Bước 2: Khởi động Tinix Inbox Server
Chạy script:
```bash
.\START.bat
# Hoặc chạy lệnh trực tiếp:
npm start
```
Server sẽ lắng nghe tại: **`http://127.0.0.1:3182`**

---

## 4. Hướng Dẫn Sử Dụng Giao Diện & Tính Năng

### 4.1. Truy cập Native Web UI
Mở trình duyệt truy cập: **`http://127.0.0.1:3182`**

Giao diện trực quan gồm 3 phần:
1. **Sidebar Trái (Conversations List):**
   * Danh sách toàn bộ các cuộc hội thoại từ mọi kênh (Meta, Zalo, TikTok, Synthetic).
   * Hiển thị avatar, tên khách hàng, mã hội thoại, kênh kết nối và trạng thái trực tiếp.
2. **Cột Giữa (Message Timeline & Chat Box):**
   * Lịch sử hội thoại đầy đủ (tin khách hàng gửi đến, tin AI trả lời, tin nhân viên gửi).
   * **Realtime Server-Sent Events (SSE):** Tin nhắn mới xuất hiện ngay lập tức không cần F5.
   * **Huy hiệu trạng thái phát tin:**
     - `Queued`: Đang chờ trong hàng đợi.
     - `Sending`: Đang gửi sang nhà mạng.
     - `Accepted`: Nhà mạng đã nhận thành công.
     - `Delivered`: Khách đã nhận được tin nhắn.
     - `Read`: Khách đã đọc.
     - `Failed`: Thất bại (kèm nút Bấm thử lại / Redrive).
   * Hỗ trợ hiển thị ảnh đính kèm (Media Attachment Preview).
3. **Sidebar Phải (Handoff Control & Channel Info):**
   * **Công tắc Chuyển quyền Takeover:**
     - Chế độ **AI Agent**: Gemini tự động phản hồi khách hàng theo ngữ cảnh.
     - Chế độ **Human Agent**: Nhân viên tiếp quản, AI tự động tạm dừng.

---

### 4.2. Cơ chế AI Agent & Phong Cách Trả Lời
* **Tính cách tự nhiên (Human-like Persona):**
  - Xưng hô thân mật, gần gũi: *"Shop"* - *"bạn / anh / chị"*.
  - Câu trả lời cô đọng, tự nhiên (1-3 câu), giải quyết trực tiếp câu hỏi.
  - Tuyệt đối loại bỏ các mẫu câu robot rập khuôn (*"Kính chào quý khách"*, *"Tôi là trợ lý AI"*).
* **Tra cứu công cụ kinh doanh (Function Calling):**
  - Khi khách hỏi tình trạng đơn hàng (ví dụ: *"Đơn DH12345 tới đâu rồi?"*), AI sẽ tự động kích hoạt function `lookup_order`.
  - Hệ thống lấy thông tin vận đơn thời gian thực và trả về câu trả lời chính xác cho khách.
  - Hỗ trợ thêm các công cụ: `lookup_customer`, `create_crm_lead`, `send_internal_notification`.

---

### 4.3. Quản trị qua Chatwoot Dashboard
Bạn có thể đăng nhập vào Chatwoot Dashboard để quản lý nếu muốn:
* **Địa chỉ:** `http://127.0.0.1:3180`
* **Email:** `poc-admin@tinix.test`
* **Mật khẩu:** `TinixTestPoc2026!`
* Mọi tin nhắn gửi từ Chatwoot Dashboard đều được Tinix Outbox tự động bắt và gửi về kênh của khách hàng theo thời gian thực.

---

## 5. Danh Mục REST API Tham Khảo

| Phương Thức | Endpoint | Chức Năng |
| :--- | :--- | :--- |
| `GET` | `/health` | Kiểm tra tình trạng server và cấu hình AI. |
| `GET` | `/api/events` | Luồng sự kiện thời gian thực (Server-Sent Events - SSE). |
| `GET` | `/api/connections` | Lấy danh sách kết nối kênh (Meta, Zalo, Synthetic,...). |
| `GET` | `/api/conversations` | Lấy danh sách hội thoại. |
| `GET` | `/api/conversations/:id/messages` | Lấy lịch sử tin nhắn của một hội thoại (hỗ trợ phân trang `?before=ID`). |
| `POST` | `/api/conversations/:id/messages` | Gửi tin nhắn mới vào hội thoại (dạng công khai hoặc private note). |
| `POST` | `/api/conversations/:id/takeover` | Chuyển quyền hội thoại (`mode: "human"` hoặc `"ai"`). |
| `POST` | `/api/outbox/:id/retry` | Thử lại việc gửi tin nhắn outbox bị lỗi. |
| `POST` | `/webhooks/channels/:provider/:connId` | Ingestion Webhook nhận tin nhắn từ các kênh. |
| `POST` | `/webhooks/chatwoot` | Nhận callback webhook từ Chatwoot. |

---

## 6. Xử Lý Sự Cố Thường Gặp (Troubleshooting)

### Vấn đề 1: Lỗi `listen EADDRINUSE: address already in use 127.0.0.1:3182`
* **Nguyên nhân:** Cổng 3182 đang bị một tiến trình Node.js cũ chiếm dụng.
* **Cách khắc phục:**
  Chạy script [`STOP.bat`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/STOP.bat) hoặc chạy lệnh PowerShell:
  ```powershell
  Get-Process node | Stop-Process -Force
  ```
  Sau đó khởi động lại bằng `npm start`.

### Vấn đề 2: Khách nhắn tin nhưng AI không phản hồi
* **Nguyên nhân 1:** Cuộc hội thoại đang ở chế độ `Human Agent`.
  ➔ **Khắc phục:** Vào Web UI `http://127.0.0.1:3182`, chọn hội thoại đó và gạt công tắc sang **AI Agent**.
* **Nguyên nhân 2:** Chưa cấu hình `GEMINI_API_KEY` trong file [`.env`](file:///d:/___TOOLS/__TINIX/Tinix%20Inbox/.env).
  ➔ **Khắc phục:** Cập nhật API key hợp lệ trong file `.env`.

### Vấn đề 3: Tin nhắn từ Chatwoot không gửi được ra ngoài
* **Nguyên nhân:** Container `callback-receiver` chưa chuyển tiếp callback về host.
* **Khắc phục:** Chạy lệnh khởi động lại container receiver:
  ```bash
  docker restart tinix-chatwoot-v418-poc-callback-receiver-1
  ```
