# freellm

The community-owned arena for indie AI models. Two ways in: bring your own API key and chat free forever, or spend earned credits on The Pool — models kept alive by contributors. 1 credit = 1 token, metered per request.

## Stack

Cloudflare Pages (static SPA + Functions) · D1 (SQLite) · KV · Hono · React 19 + Vite 8 · Tailwind 3

## License

[AGPL-3.0](LICENSE) — network use counts as distribution, so hosted variants stay open.

## Layout

```
functions/api/[[route]].ts   Hono API (auth, chat, metering, economy)
functions/v1/[[route]].ts    OpenAI-compatible mount at /v1
functions/routes/            one router per surface
migrations/                  D1 schema, applied in order
public/
  _redirects                 SPA fallback (deep links serve index.html)
src/
  components/                AppShell, UI primitives
  pages/                     Landing + route pages
  lib/                       api client, formatting
tests/                       unit + D1-backed integration tests (node --test)
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # add secrets (openssl rand -base64 32 for ENCRYPTION_KEY)
npm run db:migrate:local         # apply D1 migrations to the local emulator
npm run dev:pages                # build + serve SPA and Functions at http://localhost:8788
```

`npm run dev` runs the Vite dev server alone (no API) — use `dev:pages` for the full stack.

## First-time Cloudflare setup (before first deploy)

```bash
npx wrangler login
npm run db:create                # creates the D1 db; paste the id into wrangler.toml
npx wrangler kv namespace create SESSIONS   # paste the id into wrangler.toml
npm run db:migrate:remote
npx wrangler pages secret put ENCRYPTION_KEY
npx wrangler pages secret put GOOGLE_CLIENT_ID
npx wrangler pages secret put GOOGLE_CLIENT_SECRET
npm run deploy                   # build + wrangler pages deploy dist
```

Then point `freellm.hasit.in` at the Pages project (CNAME to `<project>.pages.dev`) in the Cloudflare dashboard.

## Deploying

Production tracks the `main` branch (`freellm.hasit.in` serves the Production environment). The normal flow is push-to-deploy:

```bash
npm test                          # 215 unit + D1-backed integration tests
npm run db:migrate:remote         # apply pending migrations to remote D1 FIRST
git push origin main              # Pages builds (npm run build) → Production
```

Verify after each deploy:

```bash
curl -s https://freellm.hasit.in/api/health         # {"ok":true,...}
curl -s https://freellm.hasit.in/v1/models | head -c 300
npx wrangler pages deployment list # newest Production row should be your commit
```

Manual deploy (when the Git-integration build is red — Oct 2026: Pages' automatic `npm clean-install` crashes in their container before our build command runs; clear the dashboard build cache first, and if that fails, ship by hand):

```bash
npm run build
npx wrangler pages deploy dist --branch=main \
  --commit-hash=$(git rev-parse HEAD) --commit-message="$(git log -1 --pretty=%s)" \
  --commit-dirty=true   # only when the tree has uncommitted changes; omit on a clean tree
# --branch=main promotes the upload to Production; without it the upload lands in Preview
```

Pre-deploy checklist (every time, in order):

```bash
npm test                          # typecheck + unit + D1-backed integration, must be 215/215
npm run lint                      # must be zero warnings
npx wrangler d1 migrations list hasit-in --remote   # shows pending files, if any
npm run db:migrate:remote         # apply pending migrations to remote D1 FIRST
npm run deploy                    # or the manual deploy above
curl -s https://freellm.hasit.in/api/health         # {"ok":true,...}
curl -s https://freellm.hasit.in/v1/models | head -c 300
```

Two hard-won rules:

* **Migrations run before code.** The deployed Functions expect the migrated schema — migrate remote D1 before (or with) every deploy that adds a file under `migrations/`.
* **Never `DROP TABLE` a parent with live children.** D1 enforces `ON DELETE CASCADE` even under `PRAGMA foreign_keys=OFF`, so rebuilding a table (e.g. to widen a `CHECK`) silently deletes referencing rows — this wiped every provider config in Oct 2026 (recovered via D1 time-travel). Back up the child, drop it, rebuild the parent, restore the child; see `migrations/0011_latency_weighted_routing.sql` and the `tests/migration-safety.test.ts` regression test that guards it.
* **One module, one file under `functions/`.** Never ship a `.js` + `.d.ts` pair there — the Pages bundler compiles the `.d.ts` as a real module (`The constant "X" must be initialized`) and the deploy fails. Single `.ts` modules only; see `functions/lib/oauth.ts`.
* **No bare `process.env` in `functions/`.** `process` does not exist in workerd without `nodejs_compat`, so an unguarded access throws at import time and takes down every route importing the module (Oct 2026: this 500'd the entire `/v1` surface). Guard via `globalThis` with a fallback; see `baseUrl()` in `functions/lib/oauth.ts`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run dev:pages` | Full stack: build + wrangler pages dev |
| `npm run build` | Typecheck (app + functions) + production build |
| `npm run lint` | oxlint |
| `npm test` | Compiles the test project and runs unit + D1-backed integration tests on Node's built-in runner |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |
| `npm run deploy` | Build + deploy `dist` to Production (`--branch=main`) |

Tests need no extra install: the D1-backed metering suite runs against an in-process miniflare database (already in the tree via wrangler) with the real migrations applied.

## Status

Milestones 1–6 shipped: scaffold, auth, admin panel, promo codes, metering core, economy, the **M5 arena**, and the **M6 BYOK vault**.

- Google-only auth (no passwords): sign-up and sign-in happen exclusively through Google OAuth (`/api/auth/google`, KV state, email verified by Google); first account/`ADMIN_EMAIL` → admin role; referral codes ride along via `?ref=`; email verification gates earning (MailChannels in production, dev link locally)
- Admin panel (`/admin`): model aliases + grouped OpenAI-compatible provider configs with live test-connection, plus promo codes (global or alias-scoped, limits/expiry/age gates)
- **Chat proxy** (`/chat`): SSE passthrough, reserve-settle accounting, provider-reported usage with flat-rate fallback, multiplexing across an alias's configs
- **Economy** (`/earn`, `/dashboard`, `/usage`): daily check-in (+50K base, day-7 +500K, day-30 +2M), one-time tasks, referrals paying +500K at 7-day tenure or 200K tokens
- **Arena** (`/battle`): 2–4 models answer one prompt blinded as A/B/C…, one-shot vote reveals identities + Elo (K=32 young / K=16 settled, pairwise), leaderboard, public replays embedded on the landing page. Each model's stream is metered separately and attributed via `usage_events.battle_id`
- **Arcade** (`/earn` → Arcade): two skill games — a typing sprint (server-dealt phrase, exact-match pay) and a memory-match (6 server-dealt pairs, pay scales with fewest pair-attempts) — plus a +7,000cr daily-clear bonus for finishing both, and levels (1 XP per 10 arcade credits; one-time 3,000×level bonus to level 6, 60,000cr lifetime max) — the retention loop that keeps players on the portal
- **BYOK vault** (`/keys`): Door 1 of the Two Doors model. Users store their own OpenAI-compatible endpoints (base URL + upstream model + bearer, AES-256-GCM at rest, validated on add). Chatting through your key is free and unmetered (`key_mode=byok` on `/api/chat`). OAuth accounts (Codex, Google, Antigravity, Grok Build, Kilo, Qoder) connect with one click — endpoint, model, and tokens fill in automatically. Google reuses the sign-in client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) unless a dedicated `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` is set; Antigravity takes `ANTIGRAVITY_OAUTH_CLIENT_ID`/`ANTIGRAVITY_OAUTH_CLIENT_SECRET` (wrangler secrets / `.dev.vars` — no redeploy, no literals in git). One provider can hold several accounts: each row keeps its own `account_id` (Google/ChatGPT account `sub`) and is labelled with that account's email, so multiple Google logins coexist instead of retiring one another. Pool credentials (Poolside/Agnes/Atria/…) are not env vars — they live encrypted in D1 (`freellm_upstream_keys`) and are managed from `/admin`. Admins can view/reveal vault keys for auditability (`/admin/vault`).
- **Support**: Need help? Email us at `help@freellm.hasit.in`. We usually respond within 2 hours.
- **OpenAI-compatible API** (`/v1`, docs at `/developers`): `GET /v1/models` and `POST /v1/chat/completions` speak the OpenAI wire format, so the OpenAI SDKs and any OpenAI-compatible client work with `baseURL: https://freellm.hasit.in/v1`. Auth is a session cookie **or** a personal `fl_…` API token (Bearer; hashed at rest, created/managed on `/developers`, verified-email-gated like the rest of earning). Pool billing, failover, and metering are the same code path as `/api/chat`

Repo hygiene: unit + integration tests (`npm test`, Node's built-in runner with a miniflare D1 for the metering suite) and CI (`.github/workflows/ci.yml`) running lint → test → build on every push/PR.

Next: the paid-tier migration path.

### Local test accounts (from the E2E run)

| Email | Password | Role |
|---|---|---|
| admin@freellm.local | supersecret123 | admin |
| user1@example.com | password123 | user (has 100k global + 50k scoped to poolside-laguna) |

### Admin bootstrap

The first registered account becomes admin (as does `ADMIN_EMAIL`). In local dev, `ADMIN_EMAIL=admin@freellm.local` is preset in `.dev.vars`.

```bash
# 1. register the first account at /register — it gets role=admin
# 2. open /admin, create an alias ("Poolside Laguna" -> slug poolside-laguna)
# 3. add provider configs to it: base URL + upstream model + bearer
# 4. hit Test — status/latency persist per config
```

An **alias** is what users chat with; each alias groups N **provider configs** (`model_providers`), and a request multiplexes across the group using the alias's routing strategy (`round_robin` | `random` | `failover` | `latency_weighted`, priority-ordered for failover, lowest-latency-first with ~15% round-robin exploration for latency_weighted). Bearer keys are AES-256-GCM encrypted with `ENCRYPTION_KEY`.

### Access tiers

Aliases carry an `access_tier` (`free` | `pro` | `enterprise`, default `free`); users carry a `tier` (default `free`, admins bypass all gates). A caller may use an alias when their tier rank >= the alias's tier rank — e.g. set `gpt-luna` to `pro` and free-tier callers get `403 upgrade_required` on `/api/chat`, `/v1/chat/completions`, and `/battle` before any reserve or hold is placed, so a denied call is never charged. Catalogs (`GET /api/models`, `GET /v1/models`) expose `access_tier` so clients can show locked state up front. Grant a tier with: `UPDATE freellm_users SET tier = 'pro' WHERE email = '…'`.

Scarce provider capacity gets a second lock: `scoped_only` on an alias means requests to it spend that alias's scoped grant balance only — global credits can never buy in, so callers without luna tokens cannot burn luna pool quota (`402 insufficient_scoped_credits`, settled with zero global movement). Pair it with a scoped promo code for the same alias; remember a premium promo still needs the matching user tier unless the alias stays `free`.

Provider retry cooldown is per config: after a failure a config waits out its `cooldown_ms` (unset = global 30m default, `0` = retry immediately, max 7 days) before it can be selected again, doubling per consecutive failure up to 8x the base. Daily-reset quotas like llm7.io or Google fit a 1440-minute base — set it in the config's Edit form ("Retry cooldown"). Unset configs keep the historic 30m → 1h → 2h → 4h ladder.