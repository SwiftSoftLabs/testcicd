CREATE TABLE app_growflowcommand.keywords (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword     text NOT NULL,
  category    text NOT NULL DEFAULT 'General',
  priority    text NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('high', 'medium', 'low')),
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  signals     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_growflowcommand.keywords ENABLE ROW LEVEL SECURITY;

GRANT ALL                            ON app_growflowcommand.keywords TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_growflowcommand.keywords TO authenticated;

CREATE POLICY keywords_own_or_max ON app_growflowcommand.keywords
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE INDEX idx_keywords_user   ON app_growflowcommand.keywords(user_id);

CREATE INDEX idx_keywords_status ON app_growflowcommand.keywords(status);
