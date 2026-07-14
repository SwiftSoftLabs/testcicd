import { loadEnvConfig } from '@next/env';

async function main() {
    // Load the app env before importing DB-backed modules; lib/db.ts reads env at import time.
    loadEnvConfig(process.cwd());
    const { rewrapAllProjectDeks } = await import('@/lib/vault/keys');

    const result = await rewrapAllProjectDeks();

    process.stdout.write(`Vault KEK rotation complete.\n`);
    process.stdout.write(`Total project keys: ${result.total}\n`);
    process.stdout.write(`Rewrapped: ${result.rewrapped}\n`);
    process.stdout.write(`Failed: ${result.failed}\n`);

    if (result.failures.length > 0) {
        for (const failure of result.failures) {
            process.stderr.write(`- ${failure.id}: ${failure.error}\n`);
        }
        process.exit(1);
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Vault KEK rotation failed: ${message}\n`);
    process.exit(1);
});
