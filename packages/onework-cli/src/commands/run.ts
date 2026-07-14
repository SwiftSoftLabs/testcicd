import { fetchEnv } from '../api';
import { spawnWithEnv } from '../spawn';

interface RunOptions {
    project: string;
    env: string;
    token?: string;
    apiUrl: string;
}

export async function runCommand(opts: RunOptions, cmd: { args: string[] }): Promise<void> {
    const token = opts.token ?? process.env.ONEWORK_TOKEN;
    if (!token) {
        console.error('Error: missing token. Set $ONEWORK_TOKEN or pass --token <token>.');
        process.exit(2);
    }

    const childArgs = cmd.args;
    if (childArgs.length === 0) {
        console.error('Error: no command to run.\nUsage: onework run --project <id> -- npm run dev');
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
    const summary = names.length === 0
        ? `[onework] No variables found in "${opts.env}"`
        : `[onework] Injected ${names.length} var${names.length === 1 ? '' : 's'} from "${opts.env}": ${names.join(', ')}`;
    console.error(summary);

    const exitCode = await spawnWithEnv(childArgs, vars);
    process.exit(exitCode);
}
