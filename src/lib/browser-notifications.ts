type PermissionResult = 'granted' | 'denied' | 'default';

interface BrowserNotificationInstance {
  onclick: (() => void) | null;
}

interface BrowserNotificationAPI {
  new(
    title: string,
    options?: { body?: string; tag?: string; icon?: string },
  ): BrowserNotificationInstance;
  permission: PermissionResult;
  requestPermission(): Promise<PermissionResult>;
}

function getNotificationAPI(): BrowserNotificationAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>)['Notification'] as BrowserNotificationAPI | undefined;
  return api ?? null;
}

export async function requestNotificationPermission(): Promise<PermissionResult> {
  const api = getNotificationAPI();
  if (!api) return 'denied';
  if (api.permission !== 'default') return api.permission;
  return api.requestPermission();
}

export function showBrowserNotification(
  title: string,
  body: string,
  options?: { tag?: string; icon?: string; onClick?: () => void },
): void {
  const api = getNotificationAPI();
  if (!api || api.permission !== 'granted') return;

  const n = new api(title, {
    body,
    tag: options?.tag,
    icon: options?.icon ?? '/favicon.ico',
  });

  if (options?.onClick) {
    const handler = options.onClick;
    n.onclick = () => {
      window.focus();
      handler();
    };
  }
}
