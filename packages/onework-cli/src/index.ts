#!/usr/bin/env node
import { program } from 'commander';
import { runCommand } from './commands/run';
import { envCommand } from './commands/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

program
    .name('onework')
    .description('OneWork CLI — inject Vault secrets without writing to disk')
    .version(version);

program
    .command('run')
    .description('Run a command with secrets injected from a OneWork Vault project')
    .requiredOption('--project <id>', 'Vault project ID')
    .option('--env <name>', 'Vault environment name', 'development')
    .option('--token <token>', 'Auth token (or set $ONEWORK_TOKEN)')
    .option(
        '--api-url <url>',
        'OneWork API base URL',
        process.env.ONEWORK_API_URL ?? 'https://app.onework.dev'
    )
    .allowUnknownOption()
    .action(runCommand);

program
    .command('env')
    .description('Print Vault variables as KEY=\'value\' lines (only vault vars, no system env)')
    .requiredOption('--project <id>', 'Vault project ID')
    .option('--env <name>', 'Vault environment name', 'development')
    .option('--token <token>', 'Auth token (or set $ONEWORK_TOKEN)')
    .option(
        '--api-url <url>',
        'OneWork API base URL',
        process.env.ONEWORK_API_URL ?? 'https://app.onework.dev'
    )
    .action(envCommand);

program.parse();
