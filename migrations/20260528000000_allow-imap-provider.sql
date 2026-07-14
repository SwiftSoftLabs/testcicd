alter table public.connected_accounts
  drop constraint if exists connected_accounts_provider_check;

alter table public.connected_accounts
  add constraint connected_accounts_provider_check
  check (provider in ('google', 'outlook', 'imap'));
