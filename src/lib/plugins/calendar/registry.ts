import { calendlyCalendarPlugin } from './calendly';
import { googleCalendarPlugin } from './google';
import { outlookCalendarPlugin } from './outlook';
import type { CalendarPluginProviderHandler } from './provider';
import type { CalendarPluginProvider } from './types';

const handlers: Record<CalendarPluginProvider, CalendarPluginProviderHandler> = {
    google_calendar: googleCalendarPlugin,
    outlook: outlookCalendarPlugin,
    calendly: calendlyCalendarPlugin,
};

export function getCalendarPluginHandler(provider: CalendarPluginProvider): CalendarPluginProviderHandler {
    const handler = handlers[provider];
    if (!handler) throw new Error(`No calendar plugin handler for ${provider}`);
    return handler;
}

export function getProviderCapabilities(provider: CalendarPluginProvider) {
    return getCalendarPluginHandler(provider).capabilities;
}
