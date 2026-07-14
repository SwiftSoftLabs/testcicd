'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  PluginIntegrationCard,
  PluginMetaItem,
  PluginSection,
  PluginsStatusLoading,
  pluginBtnPrimary,
  pluginBtnSecondary,
  type PluginConnectionStatus,
} from '@/components/settings/PluginIntegrationCard';
import type { VercelIntegrationStatus } from '@/lib/integrations/vercel/types';
import { authenticatedFetch } from '@/lib/authenticated-fetch';

interface Props {
  workspaceId: string;
  addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export function VercelPluginsSettings({ workspaceId, addToast }: Props) {
  const [status, setStatus] = useState<VercelIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authenticatedFetch(
        `/api/integrations/vercel?workspaceId=${workspaceId}`,
      );
      const json = await res.json();
      if (res.ok) setStatus(json.data);
    } catch {
      // fail open
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const vercelParam = params.get('vercel');
    const errorParam = params.get('error');
    if (!vercelParam) return;

    const dedupeKey = `ow-vercel-oauth:${params.toString()}`;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, '1');

    if (vercelParam === 'connected') {
      addToast('Vercel connected.', 'success');
      void fetchStatus();
    } else if (vercelParam === 'error') {
      addToast(errorParam ?? 'Vercel connection failed', 'error');
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('vercel');
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [addToast, fetchStatus]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await authenticatedFetch('/api/integrations/vercel', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const json = await res.json();
      if (!res.ok) {
        addToast(json.error ?? 'Disconnect failed', 'error');
        return;
      }
      addToast('Vercel disconnected.', 'warning');
      setStatus((prev) =>
        prev
          ? { ...prev, connected: false, targetName: null, targetId: null }
          : prev,
      );
    } catch {
      addToast('Network error', 'error');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleCicdAccessToggle(allowMembers: boolean) {
    if (!status?.canManageCicdAccess) return;
    setSavingAccess(true);
    try {
      const res = await authenticatedFetch('/api/integrations/vercel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, cicdAllowMembers: allowMembers }),
      });
      const json = await res.json();
      if (!res.ok) {
        addToast(json.error ?? 'Failed to update CI/CD access', 'error');
        return;
      }
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              cicdAllowMembers:
                json.data?.cicdAllowMembers ?? allowMembers,
            }
          : prev,
      );
      addToast(
        allowMembers
          ? 'Members can set up Vercel CI/CD.'
          : 'Only admins can set up Vercel CI/CD.',
        'success',
      );
    } catch {
      addToast('Network error', 'error');
    } finally {
      setSavingAccess(false);
    }
  }

  function handleConnect() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/integrations/vercel/oauth/start?workspaceId=${workspaceId}&returnTo=${encodeURIComponent(returnTo)}`;
  }

  const connectionStatus: PluginConnectionStatus = status?.connected
    ? 'connected'
    : status?.configured
      ? 'disconnected'
      : 'not_configured';

  return (
    <PluginSection
      title="Deployment"
      description="Sync Vault secrets to Vercel and set up Version Control CI/CD."
    >
      {loading ? (
        <PluginsStatusLoading count={1} label="Checking Vercel connection…" />
      ) : (
        <div className="space-y-4">
          <PluginIntegrationCard
            icon="vercel"
            title="Vercel"
            tagline="Push secrets from Vault to Vercel env vars."
            status={connectionStatus}
            meta={
              status?.connected ? (
                <>
                  {status.targetName ? (
                    <PluginMetaItem label="Team">{status.targetName}</PluginMetaItem>
                  ) : null}
                  {status.connectedBy ? (
                    <PluginMetaItem label="Connected by">
                      {status.connectedBy}
                    </PluginMetaItem>
                  ) : null}
                  {status.connectedAt ? (
                    <PluginMetaItem label="Since">
                      {new Date(status.connectedAt).toLocaleDateString()}
                    </PluginMetaItem>
                  ) : null}
                </>
              ) : undefined
            }
            errorMessage={
              !status?.configured
                ? 'Set VERCEL_CLIENT_ID, VERCEL_CLIENT_SECRET, and VERCEL_INTEGRATION_SLUG on the server.'
                : undefined
            }
            actions={
              status?.connected ? (
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className={pluginBtnSecondary}
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!status?.configured}
                  onClick={handleConnect}
                  className={pluginBtnPrimary}
                >
                  Connect
                </button>
              )
            }
          />

          {status?.configured ? (
            <div className="rounded-xl border border-border-dark bg-surface-dark/40 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-main">
                    CI/CD setup access
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Who can link Version Control repos to Vercel deployments.
                    Admins can always set up CI/CD.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-bold text-main shrink-0">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border-dark"
                    checked={status.cicdAllowMembers !== false}
                    disabled={!status.canManageCicdAccess || savingAccess}
                    onChange={(e) =>
                      void handleCicdAccessToggle(e.target.checked)
                    }
                  />
                  Allow members
                </label>
              </div>
              {!status.canManageCicdAccess ? (
                <p className="text-[11px] text-text-secondary">
                  Only workspace admins can change this setting.
                </p>
              ) : null}
            </div>
          ) : null}

          {status?.configured ? (
            <div className="rounded-xl border border-border-dark bg-surface-dark/40 px-4 py-3 space-y-1.5">
              <p className="text-sm font-semibold text-main">
                Deployment status webhooks
              </p>
              <p className="text-xs text-text-secondary">
                Integration tokens cannot create webhooks via API. In the{' '}
                <span className="text-main">Vercel Integration Console</span>,
                add a webhook for deployment events pointing to:
              </p>
              <code className="block text-[11px] text-primary/90 break-all">
                {`${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/api/integrations/vercel/webhooks`}
              </code>
              <p className="text-[11px] text-text-secondary">
                Events: deployment.created, deployment.succeeded,
                deployment.error, deployment.canceled. Sign with your
                integration client secret (or VERCEL_WEBHOOK_SECRET).
              </p>
            </div>
          ) : null}
        </div>
      )}
    </PluginSection>
  );
}
