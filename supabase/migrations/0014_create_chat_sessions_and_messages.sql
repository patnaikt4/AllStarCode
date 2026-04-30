-- Persist chat threads used by the instructor feedback workspace.
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  feedback_id uuid REFERENCES public.feedback(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_id_updated_at_idx
  ON public.chat_sessions (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_session_id_created_at_idx
  ON public.chat_messages (session_id, created_at);

CREATE OR REPLACE FUNCTION public.set_chat_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_chat_sessions_updated_at ON public.chat_sessions;
CREATE TRIGGER set_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.set_chat_sessions_updated_at();

CREATE OR REPLACE FUNCTION public.touch_chat_session_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_sessions
  SET updated_at = NEW.created_at
  WHERE id = NEW.session_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_chat_session_on_message ON public.chat_messages;
CREATE TRIGGER touch_chat_session_on_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE PROCEDURE public.touch_chat_session_on_message();

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own chat sessions" ON public.chat_sessions;
CREATE POLICY "Users can read own chat sessions"
  ON public.chat_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own chat sessions" ON public.chat_sessions;
CREATE POLICY "Users can insert own chat sessions"
  ON public.chat_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own chat session titles" ON public.chat_sessions;
CREATE POLICY "Users can update own chat session titles"
  ON public.chat_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read messages in own chat sessions" ON public.chat_messages;
CREATE POLICY "Users can read messages in own chat sessions"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_sessions
      WHERE chat_sessions.id = chat_messages.session_id
        AND chat_sessions.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert messages in own chat sessions" ON public.chat_messages;
CREATE POLICY "Users can insert messages in own chat sessions"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_sessions
      WHERE chat_sessions.id = chat_messages.session_id
        AND chat_sessions.user_id = auth.uid()
    )
    AND (
      feedback_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.feedback
        WHERE feedback.id = chat_messages.feedback_id
          AND (
            feedback.user_id = auth.uid()
            OR EXISTS (
              SELECT 1
              FROM public.profiles
              WHERE profiles.id = auth.uid()
                AND profiles.role = 'admin'
            )
          )
      )
    )
  );

-- Keep updates restricted to chat session titles; messages are append-only.
REVOKE UPDATE, DELETE ON TABLE public.chat_sessions FROM anon, authenticated, public;
REVOKE UPDATE, DELETE ON TABLE public.chat_messages FROM anon, authenticated, public;

GRANT SELECT, INSERT ON TABLE public.chat_sessions TO authenticated;
GRANT UPDATE (title) ON TABLE public.chat_sessions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.chat_messages TO authenticated;
