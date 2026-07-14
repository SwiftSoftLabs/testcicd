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
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import type { PluginIconId } from '@/lib/plugins/plugin-icons';

const CALENDAR_OAUTH_MSG_SOURCE = 'onework-calendar-oauth';

type CalendarOAuthPostMessage = {
  source?: string;
  status?: 'connected' | 'error';
  error?: string;
};

type ConferencingCard = {
  provider: 'google' | 'zoom';
  title: string;
  tagline: string;
  icon: PluginIconId;
  integrationProvider: 'google_calendar' | 'zoom';
  configuredKey: 'googleConfigured' | 'zoomConfigured';
};

const CONFERENCING_CARDS: ConferencingCard[] = [
  {
    provider: 'google',
    title: 'Google Meet',
    tagline: 'Add Google Meet links when creating calendar events.',
    icon: 'google',
    integrationProvider: 'google_calendar',
    configuredKey: 'googleConfigured',
  },
  {
    provider: 'zoom',
    title: 'Zoom',
    tagline: 'Add Zoom meeting links when creating calendar events.',
    icon: 'zoom',
    integrationProvider: 'zoom',
    configuredKey: 'zoomConfigured',
  },
];

export function CalendarConferencingPluginsSettings() {
  const { addToast } = useUIContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [calendarStatus, setCalendarStatus] = useState<
    Awaited<ReturnType<typeof api.calendarIntegrations.status>> | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProvider, setLoadingProvider] = useState<
    'google' | 'zoom' | null
  >(null);

  const refreshCalendarStatus = useCallback(async () => {
    const status = await api.calendarIntegrations.status();
    setCalendarStatus(status);
    return status;
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void refreshCalendarStatus()
      .catch(() =>
        setCalendarStatus({
          googleConfigured: false,
          zoomConfigured: false,
          integrations: [],
        }),
      )
      .finally(() => setIsLoading(false));
  }, [refreshCalendarStatus]);

  useEffect(() => {
    const calendarOAuth = searchParams.get('calendarOAuth');
    const err = searchParams.get('error');
    if (!calendarOAuth) return;

    if (calendarOAuth === 'connected') {
      addToast('Calendar integration connected.', 'success');
      void refreshCalendarStatus();
    } else if (calendarOAuth === 'error') {
      addToast(err || 'Calendar integration failed', 'error');
    }
    router.replace('/settings/plugins');
  }, [searchParams, addToast, refreshCalendarStatus, router]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as CalendarOAuthPostMessage | null;
      if (!data || data.source !== CALENDAR_OAUTH_MSG_SOURCE) return;
      if (data.status === 'connected') {
        addToast('Calendar integration connected.', 'success');
        void refreshCalendarStatus();
      } else if (data.status === 'error') {
        addToast(data.error || 'Calendar integration failed', 'error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [addToast, refreshCalendarStatus]);

  const startCalendarOAuthPopup = (provider: 'google' | 'zoom') => {
    const returnTo = `${window.location.origin}/settings/plugins`;
    const url = api.calendarIntegrations.startUrl(provider, {
      returnTo,
      popup: true,
    });
    const win = window.open(
      url,
      'onework-calendar-oauth',
      'width=520,height=720,scrollbars=yes,resizable=yes',
    );
    if (!win) addToast('Allow pop-ups to connect this provider.', 'warning');
  };

  const disconnectCalendarProvider = async (provider: 'google' | 'zoom') => {
    setLoadingProvider(provider);
    try {
      await api.calendarIntegrations.disconnect(provider);
      await refreshCalendarStatus();
      addToast(
        `${provider === 'google' ? 'Google Meet' : 'Zoom'} disconnected.`,
        'warning',
      );
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Could not disconnect provider',
        'error',
      );
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <PluginSection
      title="Video conferencing"
      description="Generate meeting links when creating calendar events."
    >
      {isLoading ? (
        <PluginsStatusLoading count={CONFERENCING_CARDS.length} />
      ) : (
        CONFERENCING_CARDS.map((card) => {
          const configured = Boolean(calendarStatus?.[card.configuredKey]);
          const integration =
            calendarStatus?.integrations.find(
              (item) => item.provider === card.integrationProvider,
            ) ?? null;
          const connected = Boolean(integration?.connected);
          const account =
            integration?.accountEmail ?? integration?.accountName ?? null;

          const status: PluginConnectionStatus = connected
            ? 'connected'
            : configured
              ? 'disconnected'
              : 'not_configured';

          return (
            <PluginIntegrationCard
              key={card.provider}
              icon={card.icon}
              title={card.title}
              tagline={card.tagline}
              status={status}
              meta={
                connected && account ? (
                  <PluginMetaItem label="Account">{account}</PluginMetaItem>
                ) : undefined
              }
              errorMessage={
                !configured
                  ? `${card.title} OAuth is not configured on the server.`
                  : undefined
              }
              actions={
                connected ? (
                  <button
                    type="button"
                    disabled={loadingProvider === card.provider}
                    onClick={() => void disconnectCalendarProvider(card.provider)}
                    className={pluginBtnSecondary}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      !configured || loadingProvider === card.provider
                    }
                    onClick={() => startCalendarOAuthPopup(card.provider)}
                    className={pluginBtnPrimary}
                  >
                    Connect
                  </button>
                )
              }
            />
          );
        })
      )}
    </PluginSection>
  );
}
