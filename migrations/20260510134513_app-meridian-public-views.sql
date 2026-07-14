CREATE OR REPLACE VIEW public.meridian_user_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.user_profiles;

CREATE OR REPLACE VIEW public.meridian_accounts
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.accounts;

CREATE OR REPLACE VIEW public.meridian_signals
  WITH (security_invoker = true)
AS SELECT
  s.*,
  a.domain  AS account_domain,
  a.name    AS account_name,
  a.size    AS account_size
FROM app_meridian.signals s
JOIN app_meridian.accounts a ON a.id = s.account_id;

CREATE OR REPLACE VIEW public.meridian_alert_rules
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.alert_rules;

CREATE OR REPLACE VIEW public.meridian_integrations
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.integrations;

CREATE OR REPLACE VIEW public.meridian_feedback
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.feedback;

CREATE OR REPLACE VIEW public.meridian_target_accounts
  WITH (security_invoker = true)
AS SELECT * FROM app_meridian.target_accounts;

GRANT SELECT ON
  public.meridian_user_profiles,
  public.meridian_accounts,
  public.meridian_signals,
  public.meridian_alert_rules,
  public.meridian_integrations,
  public.meridian_feedback,
  public.meridian_target_accounts
  TO anon, authenticated;
