# Contributing to freellm

> **Read this first.** This document describes how this project works, not how we wish it worked. It's written by maintainers who've learned these lessons the hard way.

---

## Architecture at a Glance

freellm is a **Cloudflare Workers application** (Pages + Functions) with a React 19 SPA frontend.

```
┌─────────────────────────────────────────────────────────────┐
│  freellm.hasit.in (Cloudflare Pages)                        │
├─────────────────────────────────────────────────────────────┤
│  Static SPA (dist/)                                         │
│  Functions (workers) at /api/*, /v1/*                       │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐      ┌─────────┐
   │   D1    │      │   KV     │      │  R2*    │
   │ (SQLite)│      │ (Sessions│      │(assets) │
   └─────────┘      └──────────┘      └─────────┘
```

*R2 not yet used; assets served from Pages.

### Key Boundaries

| Layer | What it owns | What it does NOT own |
|-------|--------------|----------------------|
| `functions/routes/` | HTTP handlers, validation, auth checks | Business logic, DB schema, crypto |
| `functions/lib/` | Pure logic: crypto, metering, routing, providers, auth | HTTP, request/response objects |
| `migrations/` | **Only** source of truth for D1 schema | Application code |
| `src/` | React SPA: pages, components, API client | Server logic, secrets |

**Rule:** `functions/lib/*` imports **never** import from `functions/routes/*`. The dependency arrow points one way: routes → lib.

---

## Local Development

### Prerequisites

- Node 20+ (matches CI)
- `wrangler` logged in (`npx wrangler login`)
- Cloudflare account with D1, KV, Pages access

### First-time Setup

```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars — at minimum: ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npm run db:create                    # Creates D1; paste database_id into wrangler.toml
npx wrangler kv namespace create SESSIONS   # Paste id into wrangler.toml
npm run db:migrate:local
npm run dev:pages                    # http://localhost:8788
```

### Daily Workflow

```bash
# Make changes
npm run lint                         # oxlint — must pass
npm run typecheck                    # tsc -b — must pass
npm test                             # 215 tests — must pass
npm run build                        # Production build — must pass
git push origin <branch>             # CI runs same checks
```

**Never skip `npm test` before pushing.** The test suite uses Miniflare D1 with real migrations — it catches schema drift, metering bugs, and routing regressions that typecheck alone misses.

---

## Testing Philosophy

### What We Test

| Layer | Tool | Scope |
|-------|------|-------|
| Pure logic (`lib/`) | Node `--test` + Miniflare D1 | All metering, routing, crypto, provider logic |
| HTTP handlers (`routes/`) | **Not unit-tested** — tested via integration through lib | |
| Database migrations | Miniflare applies all 34 migrations per test run | Schema compatibility, data integrity |
| Frontend | **None yet** — PRs welcome to add Playwright/Vitest | |

### Running Tests

```bash
npm test                              # Full suite (compiles + runs)
npm run test:watch                    # Watch mode for TDD
# Single test file:
node --test build-test/tests/metering.test.js
```

### Writing Tests

- Tests live in `tests/` and mirror `functions/lib/` structure
- Use `createTestDb()` from `tests/helpers/db.ts` — it gives you a fresh Miniflare D1 with all migrations applied
- Test **behavior**, not implementation: assert on DB state, return values, side effects
- See `tests/metering.test.ts` for the canonical pattern: reserve → settle → assert balances

---

## Code Standards

### TypeScript

- **Strict mode** — `tsconfig.json` has `"strict": true`. No `any` without justification comment.
- **No `process.env` in `functions/`** — Workers runtime doesn't have it. Use `env.BINDING_NAME` from `Bindings` type.
- **One module, one file** — Never ship `.js` + `.d.ts` pairs under `functions/`. The Pages bundler compiles `.d.ts` as a real module and fails with "The constant X must be initialized". Single `.ts` modules only.

### Linting

```bash
npm run lint   # oxlint — fast, Rust-based, zero-config for most things
```

- No custom rules beyond oxlint defaults
- If you disable a rule, add a comment explaining why

### Naming Conventions

| Thing | Convention | Example |
|-------|------------|---------|
| Files (lib/routes) | kebab-case | `credit-grants.ts`, `oauth-device.ts` |
| Files (React) | PascalCase | `KeyCard.tsx`, `MobileBottomNav.tsx` |
| Exports | camelCase functions, PascalCase types | `computeSpendable`, `Spendable` |
| DB columns | snake_case | `owner_id`, `created_at` |
| KV keys | `prefix:suffix` | `sess:abc123`, `ratelimit:keys:add:user123` |
| Env vars | UPPER_SNAKE_CASE | `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID` |

### Error Handling

- **Never throw strings** — throw `Error` instances with actionable messages
- **Validate at boundaries** — `functions/routes/*` validates input; `functions/lib/*` assumes valid input
- **Fail closed** — default to denying access, revealing nothing, charging nothing
- **Idempotency** — every mutating endpoint accepts `request_id` and is safe to retry

---

## Database Migrations

### The Golden Rules

1. **Migrations run before code.** The deployed Functions expect the migrated schema. Apply remote D1 migrations **before** (or with) every deploy that adds a file under `migrations/`.
2. **Never `DROP TABLE` a parent with live children.** D1 enforces `ON DELETE CASCADE` even under `PRAGMA foreign_keys=OFF`. Rebuilding a table silently deletes referencing rows — this wiped every provider config in Oct 2026 (recovered via D1 time-travel). Backup the child, drop it, rebuild the parent, restore the child.
3. **No `ALTER TABLE` adding FKs** — D1 doesn't support it on existing tables. Plan FKs in the original `CREATE TABLE` or accept app-level enforcement + indexes.
4. **Backfill in the migration** — 0033 backfills `freellm_api_keys` into `freellm_connections` in the same transaction. App code never sees a gap.

### Creating a Migration

```bash
# 1. Create file with next number: migrations/0035_<description>.sql
# 2. Write SQL — use CREATE INDEX IF NOT EXISTS, idempotent UPDATEs
# 3. Test locally:
npm run db:migrate:local
# 4. Verify schema:
npx wrangler d1 execute hasit-in --local --command "PRAGMA table_info(your_table)"
# 5. Add regression test if it guards a bug (see tests/migration-safety.test.ts)
```

---

## Secrets & Configuration

### Environment Variables

| Name | Required | Purpose | Rotation |
|------|----------|---------|----------|
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for all stored secrets (32 bytes, base64) | Rotate with migration; old data re-encrypted |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth for sign-in + BYOK vault (fallback) | Rotate in Google Console |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth secret | Rotate in Google Console |
| `GOOGLE_OAUTH_CLIENT_ID` | No | Dedicated BYOK Google client (overrides fallback) | Optional |
| `GOOGLE_OAUTH_CLIENT_SECRET` | No | Dedicated BYOK Google secret | Optional |
| `ANTIGRAVITY_OAUTH_CLIENT_ID` | No | Antigravity BYOK client | Optional |
| `ANTIGRAVITY_OAUTH_CLIENT_SECRET` | No | Antigravity BYOK secret | Optional |
| `MAIL_FROM` | Yes | Sender email for verification emails | Rare |
| `RESEND_API_KEY` | Yes | Email delivery via Resend | Rotate in Resend |
| `ADMIN_EMAIL` | No | First account with this email becomes admin | Set once |
| `CLOUDFLARE_API_TOKEN` | CI only | Pages deploy token | Rotate per policy |
| `CLOUDFLARE_ACCOUNT_ID` | CI only | Cloudflare account ID | Static |
| `ORCAROUTER_API_KEY` | CI only | OrcaCode Review | Rotate per policy |

**Never commit secrets.** `.dev.vars` is gitignored. Production secrets set via `wrangler pages secret put` or GitHub Actions secrets.

### Local vs Production

- `.dev.vars` → `wrangler pages dev` (local)
- GitHub Actions secrets + `wrangler pages secret` → Production
- The same `Bindings` type in `functions/lib/types.ts` covers both

---

## Common Tasks

### Adding a New OAuth Provider

1. Add entry to `OAUTH_PROVIDERS` in `functions/lib/oauth.ts` — include `clientIdEnv`/`clientSecretEnv` as string or string[] for fallback
2. Add device-flow or PKCE logic in `functions/lib/oauth-device.ts` if needed
3. Register callback route in `functions/routes/oauth.ts` (uses shared `saveOAuthVaultKey`)
4. Add provider to `OAuthProviders.tsx` UI component
5. Test: connect flow → vault shows key → chat works with `key_mode=byok`

### Adding a Pool Model (Admin)

1. `/admin` → create alias (slug, routing strategy, tier)
2. Add upstream provider (base URL, label) → test connection
3. Add upstream keys (bearer tokens) → they're encrypted at rest
4. Map models to provider → set capabilities, context window
5. Test: `/chat` with alias → usage appears in `/dashboard`

### Debugging Production

```bash
# Health
curl https://freellm.hasit.in/api/health

# Recent usage
npx wrangler d1 execute hasit-in --remote --json \
  --command "SELECT * FROM freellm_usage_events ORDER BY created_at DESC LIMIT 10"

# Provider health
npx wrangler d1 execute hasit-in --remote --json \
  --command "SELECT id, label, status, avg_latency_ms, consecutive_failures FROM freellm_upstream_providers"

# Live tail
npx wrangler tail --format=pretty
```

---

## PR Checklist

Before opening a PR, confirm:

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (215/215)
- [ ] `npm run build` passes
- [ ] If adding migration: `npm run db:migrate:local` works, no orphaned rows
- [ ] If changing auth/metering: ran locally with `npm run dev:pages` and tested the flow
- [ ] Commit messages follow convention (see below)
- [ ] No secrets in diff (check `git diff --name-only`)

### Commit Message Convention

```
<type>(<scope>): <imperative summary>

<body explaining why, not what>

<footer: breaking changes, migration notes, related issues>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `migration`

Examples:
```
feat(oauth): Google vault client reuses sign-in creds; multiple accounts per provider

The BYOK vault's Google/Gemini provider resolved GOOGLE_OAUTH_CLIENT_ID only,
so on this deployment Google showed as unconfigured. Env lookup is now an
ordered preference list: a dedicated GOOGLE_OAUTH_CLIENT_ID/_SECRET wins when
set, otherwise the sign-in client is reused.

migration: add FK and audit log for admin vault reveals

Adds freellm_admin_audit_log table and FK from connections.owner_id to users.id.
All reveal endpoints now require justification and write audit entries.
```

---

## Release Process

Currently **manual**:

1. `npm test && npm run lint && npm run build`
2. `npm run db:migrate:remote` (if migrations pending)
3. `git push origin main` → Cloudflare Pages builds and deploys
4. Verify: `curl https://freellm.hasit.in/api/health` + smoke test `/chat`

**Future:** semantic-release + canary deploy + automated changelog. PRs welcome.

---

## Getting Help

- **Bugs / Features:** GitHub Issues (use templates when available)
- **Security:** Email `security@freellm.hasit.in` — do not file public issues
- **Questions:** GitHub Discussions or email `help@freellm.hasit.in`
- **Architecture questions:** Read the code in `functions/lib/` — it's the source of truth

---

## License

AGPL-3.0 — network use counts as distribution. By contributing, you agree your contributions are licensed under AGPL-3.0.