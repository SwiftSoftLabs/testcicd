import type { GitProvider } from '@/types/git';

const GITHUB_SSH_READ = new Set(['read:public_key', 'admin:public_key']);

/** GitLab user SSH keys require API scope for list/create/delete. */
const GITLAB_SSH = new Set(['api']);

/** True when stored OAuth scopes clearly include SSH key access. */
export function integrationHasStoredSshScopes(
    provider: GitProvider,
    authMethod: 'oauth' | 'pat' | 'platform',
    scopes: string[],
): boolean {
    if (authMethod === 'pat' || authMethod === 'platform') return false;
    const normalized = scopes.map((s) => s.trim()).filter(Boolean);
    if (normalized.length === 0) return false;
    if (provider === 'github') {
        return normalized.some((s) => GITHUB_SSH_READ.has(s));
    }
    return normalized.some((s) => GITLAB_SSH.has(s));
}

/** True when stored OAuth scopes exist but omit SSH key access (stale connection). */
export function integrationStoredScopesLackSsh(
    provider: GitProvider,
    authMethod: 'oauth' | 'pat' | 'platform',
    scopes: string[],
): boolean {
    if (authMethod === 'pat' || authMethod === 'platform') return false;
    const normalized = scopes.map((s) => s.trim()).filter(Boolean);
    if (normalized.length === 0) return false;
    return !integrationHasStoredSshScopes(provider, authMethod, scopes);
}

export function missingSshScopesMessage(provider: GitProvider, authMethod: 'oauth' | 'pat' | 'platform'): string {
    if (authMethod === 'platform') {
        return 'Add SSH keys under the OneWork tab in Git & SSH settings.';
    }
    if (provider === 'github') {
        if (authMethod === 'pat') {
            return 'Your GitHub personal access token needs the admin:public_key scope (or read:public_key to list only). Create a new token on GitHub and reconnect.';
        }
        return 'Reconnect GitHub to grant SSH key access. Connections made before SSH support may only have repo scopes — disconnect and connect again.';
    }
    if (authMethod === 'pat') {
        return 'Your GitLab personal access token needs the api scope to manage SSH keys. Create a new token and reconnect.';
    }
    return 'Reconnect GitLab with the api scope to list and manage SSH keys.';
}
