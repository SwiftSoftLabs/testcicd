# @swiftsoftlabs/onework-vault-cli

OneWork Vault CLI — inject Vault secrets into local processes without writing them to disk.

**Do not install the bare `onework` package on npm** — that is an unrelated project. Use this scoped package.

## Requirements

- Node.js 18+
- A OneWork Vault CLI token (Max plan) from the Vault UI in your project

## Install

```bash
npm install -g @swiftsoftlabs/onework-vault-cli
onework --version
```

## Credentials

```bash
export ONEWORK_TOKEN=<token-from-vault-ui>
export ONEWORK_API_URL=https://app.onework.dev   # or your app origin / http://localhost:3000
```

`ONEWORK_TOKEN` is **not** your npm login — it is a project-scoped Vault CLI token generated in OneWork.

## Commands

Print vault variables (KEY='value' lines):

```bash
onework env --project <project-id> --env development
```

Run any command with vault vars injected:

```bash
onework run --project <project-id> --env development -- npm run dev
```

## Options

| Flag | Env var | Default |
|------|---------|---------|
| `--token` | `ONEWORK_TOKEN` | (required) |
| `--api-url` | `ONEWORK_API_URL` | `https://app.onework.dev` |
| `--project` | — | (required) |
| `--env` | — | `development` |

## Development

```bash
cd packages/onework-cli
npm install
npm run build
node dist/index.js --version
```

## License

MIT — SwiftSoftLabs
