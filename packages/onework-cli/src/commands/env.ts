import { fetchEnv } from '../api';

interface EnvOptions {
    project: string;
    env: string;
    token?: string;
    apiUrl: string;
}

function shellQuote(value: string): string {
    // POSIX single-quote with embedded-quote escape: a'b -> 'a'\''b'
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function envCommand(opts: EnvOptions): Promise<void> {
    const token = opts.token ?? process.env.ONEWORK_TOKEN;
    if (!token) {
        console.error('Error: missing token. Set $ONEWORK_TOKEN or pass --token <token>.');
        process.exit(2);
    }

    let vars: Record<string, string>;
    try {
        vars = await fetchEnv(opts.apiUrl, token, opts.project, opts.env);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    const names = Object.keys(vars).sort();
    if (names.length === 0) {
        console.error(`[onework] No variables found in "${opts.env}"`);
        return;
    }

    for (const name of names) {
        process.stdout.write(`${name}=${shellQuote(vars[name])}\n`);
    }
}
