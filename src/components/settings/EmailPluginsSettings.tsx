'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  PluginIntegrationCard,
  PluginMetaItem,
  PluginSection,
  PluginsStatusLoading,
  pluginBtnPrimary,
  pluginBtnSecondary,
  type PluginConnectionStatus,
} from '@/components/settings/PluginIntegrationCard';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import type { PluginIconId } from '@/lib/plugins/plugin-icons';
import type { MailAccountStatus } from '@/types';
import type { BillingSummary } from '@/types/billing';

const MAIL_OAUTH_MSG_SOURCE = 'onework-mail-oauth';

type MailOAuthPostMessage = {
  source?: string;
  status?: 'connected' | 'error';
  error?: string;
};

type EmailProviderId = 'gmail' | 'outlook' | 'custom';

type EmailProviderCard = {
  id: EmailProviderId;
  title: string;
  tagline: string;
  icon: PluginIconId;
};

const EMAIL_PROVIDER_CARDS: EmailProviderCard[] = [
  {
    id: 'gmail',
    title: 'Gmail',
    tagline: 'Sync Gmail via Google sign-in.',
    icon: 'google',
  },
  {
    id: 'outlook',
    title: 'Outlook',
    tagline: 'Sync Outlook via Microsoft sign-in.',
    icon: 'outlook',
  },
  {
    id: 'custom',
    title: 'Custom IMAP',
    tagline: 'Connect a domain mailbox with IMAP/SMTP credentials.',
    icon: 'custom_mail',
  },
];

export function EmailPluginsSettings() {
  const { addToast, openModal } = useUIContext();
  const { selectedWorkspaceId, currentUser } = useAppContext();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loadingMailbox, setLoadingMailbox] = useState(true);
  const [isSyncingMailbox, setIsSyncingMailbox] = useState(false);
  const [mailboxStatus, setMailboxStatus] = useState<MailAccountStatus | null>(
    null,
  );
  const [mailOAuthEnv, setMailOAuthEnv] = useState<{
    googleConfigured: boolean;
    microsoftConfigured: boolean;
  } | null>(null);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [form, setForm] = useState({
    emailAddress: '',
    username: '',
    password: '',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
  });
  const [maxInboxesPerUser, setMaxInboxesPerUser] = useState<number | null>(
    null,
  );
  const [canManageBilling, setCanManageBilling] = useState(false);
  const [currentPlanCode, setCurrentPlanCode] = useState('basic');
  const [billingPlans, setBillingPlans] = useState<BillingSummary['plans']>(
    [],
  );

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data: BillingSummary } | null) => {
        setMaxInboxesPerUser(
          json?.data?.entitlements?.max_inboxes_per_user ?? null,
        );
        setCanManageBilling(json?.data?.canManage ?? false);
        setCurrentPlanCode(json?.data?.plan?.code ?? 'basic');
        setBillingPlans(json?.data?.plans ?? []);
      })
      .catch(() => {});
  }, [selectedWorkspaceId]);

  const refreshMailboxStatus = useCallback(async () => {
    const status = (await api.email.accounts.status()) as MailAccountStatus;
    setMailboxStatus(status);
    return status;
  }, []);

  const refreshMailboxStatusUntilConnected = useCallback(
    async (opts?: { maxAttempts?: number; delayMs?: number }) => {
      const maxAttempts = opts?.maxAttempts ?? 12;
      const delayMs = opts?.delayMs ?? 400;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const status = (await api.email.accounts.status()) as MailAccountStatus;
          setMailboxStatus(status);
          if (status.connected) return status;
        } catch {
          setMailboxStatus({ connected: false, account: null });
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return null;
    },
    [],
  );

  const runMailboxOAuthSuccessFlow = useCallback(async () => {
    addToast('Mailbox connected. Updating…', 'success');
    setLoadingMailbox(true);
    try {
      const latest = await refreshMailboxStatusUntilConnected();
      if (!latest?.connected) {
        addToast(
          'Still connecting — try Sync in a moment or refresh the page.',
          'warning',
        );
        return;
      }
      try {
        await api.email.accounts.sync();
        await refreshMailboxStatus();
        addToast('Mailbox ready.', 'success');
      } catch {
        addToast('Connected — use Sync if the inbox looks empty.', 'warning');
      }
    } finally {
      setLoadingMailbox(false);
    }
  }, [addToast, refreshMailboxStatus, refreshMailboxStatusUntilConnected]);

  useEffect(() => {
    let cancelled = false;
    api.email.oauth
      .config()
      .then((c) => {
        if (!cancelled) setMailOAuthEnv(c);
      })
      .catch(() => {
        if (!cancelled)
          setMailOAuthEnv({
            googleConfigured: false,
            microsoftConfigured: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mailOAuth = searchParams.get('mailOAuth');
    const err = searchParams.get('error');
    if (!mailOAuth) return;

    const sig = searchParams.toString();
    if (typeof window !== 'undefined') {
      const dedupeKey = `ow-mail-oauth-return:${sig}`;
      if (sessionStorage.getItem(dedupeKey)) return;
      sessionStorage.setItem(dedupeKey, '1');
    }

    if (mailOAuth === 'connected') {
      void runMailboxOAuthSuccessFlow();
    } else if (mailOAuth === 'error') {
      addToast(err || 'Mailbox connection failed', 'error');
    }
    router.replace('/settings/plugins');
  }, [searchParams, addToast, runMailboxOAuthSuccessFlow, router]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as MailOAuthPostMessage | null;
      if (!data || data.source !== MAIL_OAUTH_MSG_SOURCE) return;
      if (data.status === 'connected') {
        void runMailboxOAuthSuccessFlow();
      } else if (data.status === 'error') {
        addToast(data.error || 'Mailbox connection failed', 'error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [addToast, runMailboxOAuthSuccessFlow]);

  useEffect(() => {
    let cancelled = false;
    setLoadingMailbox(true);
    api.email.accounts
      .status()
      .then((status) => {
        if (!cancelled) setMailboxStatus(status as MailAccountStatus);
      })
      .catch(() => {
        if (!cancelled) setMailboxStatus({ connected: false, account: null });
      })
      .finally(() => {
        if (!cancelled) setLoadingMailbox(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      emailAddress: prev.emailAddress || currentUser.email || '',
      username: prev.username || currentUser.email || '',
    }));
  }, [currentUser.email]);

  const isAtInboxLimit = () => {
    const currentCount = mailboxStatus?.connected ? 1 : 0;
    return maxInboxesPerUser !== null && currentCount >= maxInboxesPerUser;
  };

  const startMailOAuthPopup = (provider: 'google' | 'microsoft') => {
    if (isAtInboxLimit()) {
      openModal('plan-comparison', {
        note: 'Upgrade to connect more inboxes.',
        canManage: canManageBilling,
        currentPlan: currentPlanCode,
        plans: billingPlans,
        workspaceId: selectedWorkspaceId ?? undefined,
      });
      return;
    }
    const returnTo = `${window.location.origin}/settings/plugins`;
    const url = api.email.oauth.startUrl(provider, {
      workspaceId: selectedWorkspaceId ?? undefined,
      returnTo,
      popup: true,
    });
    const win = window.open(
      url,
      'onework-mail-oauth',
      'width=520,height=720,scrollbars=yes,resizable=yes',
    );
    if (!win) {
      addToast('Allow pop-ups to sign in with your mail provider.', 'warning');
    }
  };

  const connectCustomMailbox = async () => {
    if (isAtInboxLimit()) {
      openModal('plan-comparison', {
        note: 'Upgrade to connect more inboxes.',
        canManage: canManageBilling,
        currentPlan: currentPlanCode,
        plans: billingPlans,
        workspaceId: selectedWorkspaceId ?? undefined,
      });
      return;
    }
    setLoadingMailbox(true);
    try {
      await api.email.accounts.connect({
        providerType: 'custom',
        ...form,
      });
      addToast('Mailbox connected successfully.', 'success');
      await refreshMailboxStatus();
      setCustomExpanded(false);
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Mailbox connection failed',
        'error',
      );
    } finally {
      setLoadingMailbox(false);
    }
  };

  const syncMailbox = async () => {
    setIsSyncingMailbox(true);
    try {
      await api.email.accounts.sync();
      addToast('Mailbox sync completed.', 'success');
      await refreshMailboxStatus();
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Mailbox sync failed',
        'error',
      );
    } finally {
      setIsSyncingMailbox(false);
    }
  };

  const disconnectMailbox = async () => {
    if (!mailboxStatus?.account?.id) return;
    setLoadingMailbox(true);
    try {
      await api.email.accounts.disconnect(mailboxStatus.account.id);
      setMailboxStatus({ connected: false, account: null });
      addToast('Mailbox disconnected.', 'warning');
      await refreshMailboxStatus();
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Could not disconnect mailbox',
        'error',
      );
    } finally {
      setLoadingMailbox(false);
    }
  };

  const connectedAccount = mailboxStatus?.connected
    ? mailboxStatus.account
    : null;
  const connectedProvider = connectedAccount?.providerType;

  const providerCardForConnected = EMAIL_PROVIDER_CARDS.find(
    (c) => c.id === connectedProvider,
  );

  const customFormFooter = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={form.emailAddress}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, emailAddress: e.target.value }))
          }
          placeholder="Mailbox email"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
        <input
          value={form.username}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, username: e.target.value }))
          }
          placeholder="Username"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
        <input
          type="password"
          value={form.password}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, password: e.target.value }))
          }
          placeholder="Password / app password"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white sm:col-span-2"
        />
        <input
          value={form.imapHost}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, imapHost: e.target.value }))
          }
          placeholder="IMAP host"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
        <input
          type="number"
          value={form.imapPort}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              imapPort: Number(e.target.value || 993),
            }))
          }
          placeholder="IMAP port"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
        <input
          value={form.smtpHost}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, smtpHost: e.target.value }))
          }
          placeholder="SMTP host"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
        <input
          type="number"
          value={form.smtpPort}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              smtpPort: Number(e.target.value || 465),
            }))
          }
          placeholder="SMTP port"
          className="rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-white"
        />
      </div>
      <button
        type="button"
        onClick={() => void connectCustomMailbox()}
        disabled={loadingMailbox}
        className={pluginBtnPrimary}
      >
        {loadingMailbox ? 'Connecting…' : 'Connect mailbox'}
      </button>
    </div>
  );

  function renderDisconnectedCard(card: EmailProviderCard) {
    if (card.id === 'gmail') {
      const configured = mailOAuthEnv?.googleConfigured ?? false;
      const status: PluginConnectionStatus = configured
        ? 'disconnected'
        : 'not_configured';
      return (
        <PluginIntegrationCard
          key={card.id}
          icon={card.icon}
          title={card.title}
          tagline={card.tagline}
          status={status}
          errorMessage={
            !configured
              ? 'Google OAuth is not configured on the server.'
              : undefined
          }
          actions={
            <button
              type="button"
              disabled={!configured || loadingMailbox}
              onClick={() => startMailOAuthPopup('google')}
              className={pluginBtnPrimary}
            >
              Connect
            </button>
          }
        />
      );
    }

    if (card.id === 'outlook') {
      const configured = mailOAuthEnv?.microsoftConfigured ?? false;
      const status: PluginConnectionStatus = configured
        ? 'disconnected'
        : 'not_configured';
      return (
        <PluginIntegrationCard
          key={card.id}
          icon={card.icon}
          title={card.title}
          tagline={card.tagline}
          status={status}
          errorMessage={
            !configured
              ? 'Microsoft OAuth is not configured on the server.'
              : undefined
          }
          actions={
            <button
              type="button"
              disabled={!configured || loadingMailbox}
              onClick={() => startMailOAuthPopup('microsoft')}
              className={pluginBtnPrimary}
            >
              Connect
            </button>
          }
        />
      );
    }

    return (
      <PluginIntegrationCard
        key={card.id}
        icon={card.icon}
        title={card.title}
        tagline={card.tagline}
        status="disconnected"
        actions={
          <button
            type="button"
            onClick={() => setCustomExpanded((v) => !v)}
            className={pluginBtnPrimary}
          >
            {customExpanded ? 'Hide form' : 'Configure'}
          </button>
        }
        footer={customExpanded ? customFormFooter : undefined}
      />
    );
  }

  return (
    <PluginSection
      title="Email"
      description="Connect one mailbox to sync inbox, sent, and drafts into OneWork."
    >
      {loadingMailbox && !mailboxStatus ? (
        <PluginsStatusLoading count={3} label="Checking mailbox connection…" />
      ) : connectedAccount && providerCardForConnected ? (
        <PluginIntegrationCard
          icon={providerCardForConnected.icon}
          title={providerCardForConnected.title}
          tagline={providerCardForConnected.tagline}
          status="connected"
          meta={
            <>
              <PluginMetaItem label="Address">
                {connectedAccount.emailAddress}
              </PluginMetaItem>
              <PluginMetaItem label="Last sync">
                {connectedAccount.lastSyncAt
                  ? new Date(connectedAccount.lastSyncAt).toLocaleString()
                  : 'Never'}
              </PluginMetaItem>
              <PluginMetaItem label="Messages">
                {connectedAccount.syncedMessages}
              </PluginMetaItem>
            </>
          }
          errorMessage={
            connectedAccount.reconnectRequired
              ? 'Reconnect with Microsoft to enable Graph sync.'
              : connectedAccount.status === 'error'
                ? 'Mailbox sync error — try Sync or reconnect.'
                : undefined
          }
          note={
            connectedAccount.quota_locked
              ? 'Read-only on your current plan — upgrade to send and sync.'
              : undefined
          }
          actions={
            <>
              {connectedAccount.reconnectRequired &&
              mailOAuthEnv?.microsoftConfigured ? (
                <button
                  type="button"
                  onClick={() => startMailOAuthPopup('microsoft')}
                  disabled={loadingMailbox}
                  className={pluginBtnPrimary}
                >
                  Reconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void syncMailbox()}
                  disabled={
                    loadingMailbox ||
                    isSyncingMailbox ||
                    connectedAccount.quota_locked
                  }
                  className={pluginBtnPrimary}
                >
                  {isSyncingMailbox ? 'Syncing…' : 'Sync now'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void disconnectMailbox()}
                disabled={loadingMailbox}
                className={pluginBtnSecondary}
              >
                Disconnect
              </button>
            </>
          }
        />
      ) : (
        EMAIL_PROVIDER_CARDS.map((card) => renderDisconnectedCard(card))
      )}
    </PluginSection>
  );
}
