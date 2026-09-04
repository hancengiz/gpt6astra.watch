# Astra Watch

Astra Watch has two parts:

- **[gpt6astra.watch](https://gpt6astra.watch)** — a crowd-watched cosmic
  rollout map. People can say they are still waiting, then convert that same
  vote when GPT-6 Astra lands; active anonymous watchers appear in the public
  monitoring counter. The served
  [`SKILL.md`](site/public/SKILL.md) labels the request-network country only as
  an unconfirmed hint, requires the person to confirm their real country, and
  then asks one yes/no consent question before installing anything.
- **`check_astra.py`** — a ground-truth local checker for the currently
  signed-in Codex account. It sends one desktop notification when
  `gpt-6-astra` becomes picker-visible.

The checker does not use an OpenAI API key, scrape ChatGPT, or make model
inference requests. It talks to the local `codex app-server` process and uses
its documented `model/list` method.

## Changelog

### 2026-09-04

- Added reversible **I don't have Astra yet** votes. The reporting browser can
  later convert its waiting vote into a positive report without creating a
  second identity; waiting votes never light a country or enter the live feed.
- Made the complete 249-country ISO catalog plus Kosovo available to the map,
  including valid countries absent from the coarse map geometry. When edge
  detection is unavailable, the UI shows **Country not detected** and requires
  an explicit selection; browser timezone is never used as country authority.
- Added map views for all activity, manual **I got Astra** reports,
  **Desperately waiting** responses, and skill/script signals. The waiting view
  replaces rollout stars with animated sad-face markers sized by waiting count.
- Added consented watcher heartbeats, a public active-monitoring count, separate
  account-access and country-level completion events, and anonymous wait-time
  statistics.
- Personalized the served `SKILL.md` with an unconfirmed Cloudflare
  request-network hint, then required explicit country confirmation and a
  yes/no privacy answer before installing anything.
- Added private D1 funnel analytics from unique skill requests through watcher
  installation and access, using only salted one-way identifiers.
- Added a descriptive watcher User-Agent for Cloudflare compatibility and
  redirected every public HTTP route to HTTPS.
- Limited manual map reporting to one active report per salted IP hash and
  country. Duplicate attempts receive a community-integrity reminder.
- Added exact report undo using a country-scoped secure HttpOnly cookie whose
  HMAC hash is stored with the report; watcher access signals cannot be removed
  through this path.
- Added the **Skill/script reports only** map filter and three humorous
  confirmations when a manual report differs from the detected current
  country.
- Updated `SKILL.md` to prohibit fake production reports or watcher events
  during testing and to guide users through the same-browser undo flow.

## Run manually

```bash
./check_astra.py --force --no-notify
```

A normal unavailable result looks like:

```json
{"checked_at":"...","model":"gpt-6-astra","picker_models_seen":7,"status":"absent"}
```

Test desktop notifications without changing the availability state:

```bash
./check_astra.py --test-notification
```

State is stored at `~/.local/state/astra-watch/state.json` with mode `0600`.
After the success notification is sent, later runs exit without querying Codex,
preventing duplicate alerts. Authentication or network failures are never
treated as evidence that the model is unavailable. After three consecutive
failures, the watcher sends one health notification. With explicit consent,
`--share-country CC` sends a stable anonymous heartbeat on each scheduled run
and a still-waiting confirmation only after a successful absent result. These
temporary confirmations join the website waiting total without lighting a
country. One idempotent access event removes the watcher from waiting when
Astra appears. Errors never count as waiting.

## User systemd timer

The installed user timer runs the checker every ten minutes. Inspect it with:

```bash
systemctl --user status astra-watch.timer
systemctl --user list-timers astra-watch.timer
journalctl --user -u astra-watch.service
```

Run an immediate scheduled check:

```bash
systemctl --user start astra-watch.service
```

Pause or resume it:

```bash
systemctl --user disable --now astra-watch.timer
systemctl --user enable --now astra-watch.timer
```

The timer is persistent, so a missed check is run after the user session starts
again. Desktop notifications require an active graphical session.

## Design references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)

## Public map

The complete deployment output lives in `site/public/`:

- `index.html`, `style.css`, `app.js` — the cosmic map, report-view filters,
  waiting/sad-face and active-monitoring visuals, ticker, country panel, and
  vote-conversion flow.
- `crimea.js` — request-location normalization and the Ukraine-owned Crimea and
  Sevastopol map overlay, derived from geoBoundaries gbOpen UKR ADM1 at pinned
  commit `9469f09` (OpenStreetMap contributors, ODbL 1.0).
- `_worker.js` — Pages advanced-mode Worker for `/api/*` plus the personalized
  `/SKILL.md` response.
- `SKILL.md` and `skill/` — raw agent instructions plus the human-facing
  "Join the Stargazers" page.
- `scripts/check_astra.py` — the downloadable copy of the local checker. Keep
  it byte-for-byte in sync with the root `check_astra.py`.

The API stores positive reports, waiting votes, and consented anonymous watcher
sessions in D1. A watcher counts as active for 25 minutes after its latest
heartbeat and stops
counting when it sends an access or country-completion event. Start and
completion times preserve anonymous wait-duration statistics. Three distinct
web reporters or two distinct account-access signals mark a country as lit.
The map can filter to skill/script signals only. D1 permits one active manual
response per salted IP hash and country. Its browser receives a secure,
HTTP-only ownership token. That browser can change a waiting vote to an access
report even after its IP changes, correct it back to waiting, or remove it.
Manual and fresh account-watcher waiting confirmations share one deduplicated
total per network and country. Waiting responses remain separate from the
positive report ledger and never affect country rollout thresholds. Legacy
reports remain untouched by migrations.
From the same network, repeating a pre-undo legacy report once claims the
existing IP/country record for same-browser management without duplication.

Every `/SKILL.md` GET also records request-network country, first/last request
time, request count, and a salted one-way IP hash for private funnel analytics.
That network location may belong to an AI relay or VPN and is never treated as
the user's confirmed country. The public API never returns these analytics.
Administrators can query the D1-only view:

```bash
cd site
npx wrangler d1 execute astra-watch --remote \
  --command "SELECT * FROM internal_funnel ORDER BY unique_skill_requesters DESC"
```

The funnel compares unique skill requesters, watcher installations, completed
watchers, and account-access outcomes by country. Salted hashes permit an
approximate request-to-install join without retaining raw IPs.

## Local website development

```bash
cd site
npx wrangler d1 execute astra-watch --file schema.sql --local
npx wrangler pages dev
```

Open `http://localhost:8788`. Local D1 state is under `.wrangler/` and is
gitignored.

## Current live deployment

`https://gpt6astra.watch` currently runs from the temporary Worker
`gpt6astra-watch-temporary`, deployed from `site/wrangler.worker.toml`. This
keeps the site live from the local folder without creating a Direct Upload
Pages project (which would permanently block later Git integration).

Redeploy the current live Worker from this checkout:

```bash
cd site
npx wrangler deploy -c wrangler.worker.toml
```

The Worker uses the production `astra-watch` D1 database in EEUR. The
`IP_HASH_SECRET` value exists only as a Worker secret.
Apply upgrades to an existing deployment before deploying new Worker code:

```bash
cd site
npx wrangler d1 execute astra-watch \
  --file migrations/0002_active_monitoring.sql --remote
npx wrangler d1 execute astra-watch \
  --file migrations/0003_report_undo.sql --remote
npx wrangler d1 execute astra-watch \
  --file migrations/0004_waiting_votes.sql --remote
npx wrangler d1 execute astra-watch \
  --file migrations/0005_watcher_waiting.sql --remote
```


When the Git-integrated Pages project below is ready:

1. Set its own `IP_HASH_SECRET` Pages secret.
2. Verify its `*.pages.dev` URL.
3. In the temporary Worker, remove `gpt6astra.watch` under **Settings →
   Domains & Routes**.
4. Attach `gpt6astra.watch` under the Pages project's **Custom domains**.
5. Delete `gpt6astra-watch-temporary` after the Pages domain is healthy.


## Cloudflare Pages production setup

### 1. Create and initialize D1

```bash
cd site
npx wrangler login
npx wrangler d1 create astra-watch
```

Paste the returned database ID into `site/wrangler.toml` as `database_id`.
The ID names a Cloudflare resource; it is safe and expected to commit. Then:

```bash
npx wrangler d1 execute astra-watch --file schema.sql --remote
```

### 2. Create the Pages project through Git integration

This order matters. **Do not run `wrangler pages project create` first**:
Cloudflare Direct Upload projects cannot later switch to Git integration.

1. Push this repository to `github.com/hancengiz/gpt6astra.watch`.
2. In Cloudflare: **Workers & Pages → Create application → Pages → Connect to
   Git**.
3. Select `hancengiz/gpt6astra.watch`.
4. Production branch: `main`.
5. Root directory: `site`.
6. Build command: leave blank.
7. Build output directory: `public`.
8. Use the Pages V2 build system.

Every push to `main` now creates a production deployment; other branches create
preview deployments.

### 3. Set the IP-hash secret

After the Git-integrated Pages project exists:

```bash
cd site
openssl rand -hex 32 | npx wrangler pages secret put IP_HASH_SECRET \
  --project-name gpt6astra-watch
```

The value is stored only in Cloudflare. Production report and watcher-signal
endpoints fail closed with HTTP 503 until it is present; public status reads
and the skill itself remain available.

### 4. Direct local-folder deploy

The same Git-integrated Pages project also accepts manual Wrangler deployments:

```bash
cd site
npx wrangler pages deploy --branch main
```

Wrangler reads `pages_build_output_dir = "public"` from `wrangler.toml`.
For a preview, replace `main` with a preview branch name.

### 5. Attach the domain

In the Pages project: **Custom domains → Set up a custom domain** → enter
`gpt6astra.watch`. Add `www.gpt6astra.watch` only if wanted; the product and
canonical URL use the apex domain.

## Public-repository safety

- No OpenAI, GitHub, or Cloudflare credentials belong in this repository.
- `.env*`, `.dev.vars`, `.wrangler/`, and `node_modules/` are gitignored.
- `IP_HASH_SECRET` is set only through Wrangler/Cloudflare.
- `database_id` is a resource identifier, not a credential.
