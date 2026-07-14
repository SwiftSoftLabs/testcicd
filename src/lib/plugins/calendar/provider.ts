import type {
    CalendarListItem,
    CalendarPluginInstallationRow,
    NormalizedPluginEvent,
    PluginEventLinkRow,
    PluginEventSnapshot,
    ProviderCapabilities,
    PullChangesResult,
} from './types';

export interface CalendarPluginProviderHandler {
    listCalendars(installation: CalendarPluginInstallationRow): Promise<CalendarListItem[]>;
    pullChanges(installation: CalendarPluginInstallationRow): Promise<PullChangesResult>;
    pushCreate(installation: CalendarPluginInstallationRow, event: PluginEventSnapshot): Promise<{ externalEventId: string; externalCalendarId: string | null; etag: string | null }>;
    pushUpdate(installation: CalendarPluginInstallationRow, link: PluginEventLinkRow, event: PluginEventSnapshot): Promise<void>;
    pushDelete(installation: CalendarPluginInstallationRow, link: PluginEventLinkRow): Promise<void>;
    registerWebhook?(installation: CalendarPluginInstallationRow): Promise<void>;
    capabilities: ProviderCapabilities;
}

export type { NormalizedPluginEvent, PullChangesResult };
