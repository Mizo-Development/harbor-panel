# Development and checks

Use Node.js 24, npm, PostgreSQL 17 and Redis. The repository is an npm workspace: applications live in apps/, shared contracts in packages/sdk/, deployment helpers in scripts/ and provider configuration in infra/.

```bash
npm ci
docker compose -f compose.dev.yaml up -d
npm run dev:setup
npm run dev
# Separate terminal:
npm run worker
```

The setup helper creates a local `.env` only when absent, generates keys, generates Prisma and applies migrations. Read its setup token privately. Do not use development database defaults on a public server.

## Build and types

```bash
npm run db:generate
npm run build
npm run typecheck
```

Build generates Next route types and all API/SDK/agent outputs. Generated builds and dependency folders are not tracked. A root install and SDK build are required before application workspaces can use the shared contracts.

## Tests

```bash
npm test
TEST_DATABASE_URL=postgresql://harbor:harbor@127.0.0.1:5432/harbor_test npm test
TEST_DATABASE_URL=postgresql://harbor:harbor@127.0.0.1:5432/harbor_ui_test npm run test:e2e
TEST_DATABASE_URL=postgresql://harbor:harbor@127.0.0.1:5432/harbor_ui_test npx playwright test --config playwright.games.config.ts
```

Create the dedicated test databases first. Integration/browser setup requires database names ending in `_test` and resets those databases. Never point tests at a production database. Install Chromium for browser tests with `npx playwright install --with-deps chromium`.

The API suite exercises billing, concurrency, ownership, extensions, callbacks and provider HTTP contracts. Some installer tests use disposable chroots/mocked commands and require root; they do not certify a fresh VPS install. Browser suites cover normal panel workflows and isolated game/responsive cases. Real provider/gateway acceptance must be performed separately.

## Extending Harbor

See [plugins and themes](extensions.md). Keep service ownership and API scope checks on every new customer route. Do not expose hidden provider credentials or infer payment from an unverified browser redirect. Runtime plugin/theme/data directories belong to the self-hosted deployment, not Git.

Before contributing, run the appropriate checks and explain what was actually tested. Do not include `.env`, database dumps, uploaded files, real API keys, node enrollments or customer records in an issue/commit/screenshot.
