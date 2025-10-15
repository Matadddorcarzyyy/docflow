# DocFlow API

Base URL: http://localhost:8080

## Auth
- POST /api/auth/register { email, password, role?, full_name? } -> { token, user }
- POST /api/auth/login { email, password } -> { token, user }
- GET /api/auth/me (Bearer) -> { id, email, role, full_name }

## Documents
- GET /api/documents -> [ { id, title, base_price } ]

## Chats
- POST /api/chats { visitor_id? } -> { id, created_at }
- GET /api/chats (Bearer: lawyer|admin|owner) -> [ { id, visitor_id, created_at } ]
- GET /api/chats/:chatId/messages (Bearer) -> [ { id, sender, text, created_at } ]
- POST /api/chats/:chatId/messages { sender, text } -> { id, created_at }
- POST /api/chats/:chatId/upload (multipart/form-data: file) -> { url, original }
- GET /api/chats/:chatId/files -> [ { id, uploader_role, original_name, url, created_at } ]

## Orders & Payments
- POST /api/orders { document_id, email, price, payload? } -> { id, created_at }
- POST /api/payments/start { provider, order_id, amount, description?, email? } -> { url }
- POST /api/payments/webhook/yookassa (YooKassa webhook)

## AI
- POST /api/ai/draft { prompt } -> { draft }
- POST /api/ai/embedding { text } -> { vector }

## Stats
- GET /api/stats (Bearer: owner|admin) -> { users, chats, messages, orders }

Auth: Bearer token в заголовке Authorization.
