# Chatbot

The chatbot is a RAG-powered instructional assistant for AllStarCode instructors. It answers questions about CS teaching and AllStarCode curriculum, and can give specific feedback on an uploaded lesson plan PDF.

For how curriculum context is retrieved, see [curriculum-embeddings.md](./curriculum-embeddings.md).

---

## API Routes

### `POST /api/chat/start`

Creates a new empty chat session for the logged-in user.

**Auth:** required (any role)

**Response `201`:**
```json
{ "sessionId": "<uuid>" }
```

---

### `POST /api/chat/message`

Sends a user message to an existing session and returns the assistant's reply. The session row is upserted on the first message (so the client can generate the UUID client-side and call `/message` directly without calling `/start` first). Up to the 10 most recent messages are included as conversation history.

**Auth:** required

**Request body:**
```json
{
  "sessionId": "<uuid>",
  "message": "How do I introduce for-loops to beginners?",
  "fileId": "<uuid>"
}
```

`fileId` is optional. When provided, the PDF at that file record is downloaded, text is extracted, and the lesson plan is included in the prompt so the assistant can give specific feedback on it.

**Response `200`:**
```json
{
  "success": true,
  "sessionId": "<uuid>",
  "assistantMessage": "...",
  "userMessageId": "<uuid>",
  "assistantMessageId": "<uuid>"
}
```

**Behavior notes:**
- The user message is saved to `chat_messages` **before** the LLM call so a failed generation still leaves an auditable record.
- If `fileId` references a file not owned by the session user, `lessonPlanText` silently resolves to `null` (no error — the message continues without file context).
- The session title is set from the first 80 characters of the first message.

---

### `GET /api/chat/sessions`

Returns all chat sessions owned by the logged-in user, ordered by most recently updated.

**Auth:** required

**Query params:**
- `fileId` (optional UUID) — filter to sessions linked to a specific lesson plan file

**Response `200`:**
```json
{
  "sessions": [
    {
      "id": "<uuid>",
      "title": "How do I introduce for-loops?",
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:05:00Z",
      "lastMessagePreview": "Here are three approaches..."
    }
  ]
}
```

`lastMessagePreview` is the most recent message content, truncated to 120 characters.

---

### `GET /api/chat/sessions/:sessionId`

Returns a single session and all of its messages in chronological order.

**Auth:** required — returns 404 (not 403) if the session belongs to another user to prevent ID enumeration.

**Response `200`:**
```json
{
  "session": {
    "id": "<uuid>",
    "title": "...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "messages": [
    { "id": "<uuid>", "role": "user", "content": "...", "createdAt": "..." },
    { "id": "<uuid>", "role": "assistant", "content": "...", "createdAt": "..." }
  ]
}
```

---

## Chat response generation

**File:** `apps/web/lib/chat/get-chat-response-from-rag.ts`

**`getChatResponseFromRag({ message, history?, lessonPlanText? })`**

1. Strips invalid UTF-16 surrogates from all input strings.
2. Calls `retrieveCurriculumContext(message)` to fetch the top 3 relevant curriculum chunks (see [curriculum-embeddings.md](./curriculum-embeddings.md)).
3. Builds a prompt including: curriculum context, optional lesson plan text, conversation history (formatted as `Instructor: ...` / `Assistant: ...`), and the current message.
4. Calls OpenAI with the instructional assistant system prompt.
5. Returns the response text.

**Model:** `OPENAI_CHAT_MODEL` env var → falls back to `OPENAI_FEEDBACK_MODEL` → `gpt-4o-mini`

**Max output tokens:** `OPENAI_CHAT_MAX_OUTPUT_TOKENS` env var → default 2048, capped at 16,000

**System prompt behavior:**
- Scoped strictly to CS education and AllStarCode curriculum
- Off-topic messages (politics, personal advice, entertainment) receive a professional redirect, not an answer
- Harmful or discriminatory content receives a calm redirect

---

## Database tables

| Table | Relevant columns |
|---|---|
| `chat_sessions` | `id` (uuid), `user_id`, `title`, `file_id` (linked lesson plan), `created_at`, `updated_at` |
| `chat_messages` | `id`, `session_id`, `role` (`user`/`assistant`), `content`, `feedback_id` (set when a feedback generation result is linked to the session), `created_at` |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for all OpenAI calls |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Model used for chat responses |
| `OPENAI_CHAT_MAX_OUTPUT_TOKENS` | `2048` | Max tokens for chat responses (hard cap: 16,000) |
