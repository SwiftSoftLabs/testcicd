import { spawn } from 'child_process';

export function spawnWithEnv(
    args: string[],
    injected: Record<string, string>,
): Promise<number> {
    return new Promise((resolve) => {
        const [cmd, ...rest] = args;
        if (!cmd) {
            console.error('Error: no command provided.');
            resolve(2);
            return;
        }

        const child = spawn(cmd, rest, {
            stdio: 'inherit',
            env: { ...process.env, ...injected },
            shell: false,
        });

        const forward = (sig: NodeJS.Signals) => () => {
            if (!child.killed) child.kill(sig);
        };
        process.on('SIGINT', forward('SIGINT'));
        process.on('SIGTERM', forward('SIGTERM'));
        process.on('SIGHUP', forward('SIGHUP'));

        child.on('exit', (code, signal) => {
            if (signal) {
                const sigNum = ((process as unknown as { constants: Record<string, number> }).constants ?? {})[signal] ?? 0;
                resolve(128 + sigNum);
            } else {
                resolve(code ?? 0);
            }
        });

        child.on('error', (err) => {
            console.error(`Failed to start "${cmd}": ${err.message}`);
            resolve(127);
        });
    });
}
