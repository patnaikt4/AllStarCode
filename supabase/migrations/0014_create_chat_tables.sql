-- ============================================================
-- 0014_create_chat_tables.sql
--
-- Creates the chat_sessions and chat_messages tables for the
-- in-app chat/feedback conversation feature.
--
-- Naming: Postgres columns use snake_case (user_id, created_at).
--         The API layer maps to camelCase (sessionId, userId).
-- ============================================================

-- ── chat_sessions ───────────────────────────────────────────

CREATE TABLE chat_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        DEFAULT 'New chat',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for listing sessions by recency on the dashboard.
CREATE INDEX idx_chat_sessions_user_updated
  ON chat_sessions (user_id, updated_at DESC);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see, create, update, and delete their own sessions.
CREATE POLICY "users select own sessions"
  ON chat_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own sessions"
  ON chat_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own sessions"
  ON chat_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own sessions"
  ON chat_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Keep updated_at current whenever a session row is touched.
CREATE OR REPLACE FUNCTION update_chat_session_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_session_timestamp();


-- ── chat_messages ───────────────────────────────────────────

CREATE TABLE chat_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fetching an ordered conversation history.
CREATE INDEX idx_chat_messages_session_created
  ON chat_messages (session_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Every message policy checks that the parent session belongs
-- to the current user.  This prevents users from reading or
-- injecting messages into another user's session.

CREATE POLICY "users select own messages"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "users insert own messages"
  ON chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "users delete own messages"
  ON chat_messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

-- Bump the parent session's updated_at whenever a new message
-- arrives, so "last activity" sorting works without extra calls.
CREATE OR REPLACE FUNCTION bump_chat_session_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_sessions
     SET updated_at = now()
   WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_messages_bump_session
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION bump_chat_session_on_message();
