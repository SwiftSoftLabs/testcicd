export type CalendarPluginProvider = 'google_calendar' | 'outlook' | 'calendly';

export type PluginSyncOrigin = 'import' | 'export' | 'local';

export interface CalendarPluginInstallationRow {
    id: string;
    user_id: string;
    provider: CalendarPluginProvider;
    account_email: string | null;
    account_name: string | null;
    account_id: string;
    scopes: string[];
    encrypted_token: string;
    encrypted_refresh: string | null;
    token_expires_at: string | null;
    status: 'connected' | 'error' | 'revoked';
    settings: Record<string, unknown>;
    sync_cursor: Record<string, unknown>;
    webhook_channel_id: string | null;
    webhook_expires_at: string | null;
    last_synced_at: string | null;
    last_sync_error: string | null;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface PluginEventLinkRow {
    id: string;
    event_id: string;
    installation_id: string;
    external_event_id: string;
    external_calendar_id: string | null;
    external_updated_at: string | null;
    external_etag: string | null;
    last_pushed_at: string | null;
    last_pulled_at: string | null;
    sync_origin: PluginSyncOrigin;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface CalendarPluginStatus {
    provider: CalendarPluginProvider;
    connected: boolean;
    accountEmail: string | null;
    accountName: string | null;
    status: 'connected' | 'error' | 'revoked' | 'disconnected';
    lastSyncedAt: string | null;
    lastSyncError: string | null;
}

export interface CalendarListItem {
    id: string;
    name: string;
    primary?: boolean;
}

export interface NormalizedPluginEvent {
    externalEventId: string;
    externalCalendarId: string | null;
    title: string;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay: boolean;
    status: 'confirmed' | 'cancelled';
    externalUpdatedAt: string | null;
    externalEtag: string | null;
    metadata?: Record<string, unknown>;
}

export interface PullChangesResult {
    events: NormalizedPluginEvent[];
    deletedExternalIds: string[];
    nextCursor: Record<string, unknown>;
}

export interface PluginEventSnapshot {
    title: string;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay: boolean;
    status: 'confirmed' | 'cancelled';
}

export interface ProviderCapabilities {
    canCreateArbitraryEvents: boolean;
    canUpdateEvents: boolean;
    canDeleteEvents: boolean;
    supportsWebhooks: boolean;
}
