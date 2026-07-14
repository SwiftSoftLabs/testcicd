export async function fetchEnv(
    apiUrl: string,
    token: string,
    projectId: string,
    envName: string,
): Promise<Record<string, string>> {
    const url = new URL('/api/vault/cli/env-stream', apiUrl);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('environment', envName);

    let res: Response;
    try {
        res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch (err) {
        throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.status === 401) {
        throw new Error('Invalid or expired token. Generate a new one in the Vault UI.');
    }
    if (res.status === 403) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Forbidden. Max plan required.');
    }
    if (res.status === 404) {
        throw new Error(`Environment "${envName}" not found in this project.`);
    }
    if (res.status === 429) {
        throw new Error('Rate limit exceeded. Wait a moment and try again.');
    }
    if (!res.ok) {
        throw new Error(`Vault returned ${res.status}: ${await res.text()}`);
    }

    const json = await res.json() as { data: { vars: Record<string, string> } };
    return json.data.vars;
}
