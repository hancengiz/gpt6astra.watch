# Astra Watch

Astra Watch has two parts:

- **[gpt6astra.watch](https://gpt6astra.watch)** — a crowd-watched cosmic
  rollout map. People light up their country when GPT-6 Astra lands; agents can
  join the stargazers by reading the public [`SKILL.md`](site/public/SKILL.md).
- **`check_astra.py`** — a ground-truth local checker for the currently
  signed-in Codex account. It sends one desktop notification when
  `gpt-6-astra` becomes picker-visible.

The checker does not use an OpenAI API key, scrape ChatGPT, or make model
inference requests. It talks to the local `codex app-server` process and uses
its documented `model/list` method.

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
failures, the watcher sends one health notification.

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

- `index.html`, `style.css`, `app.js` — the cosmic map, live counters, ticker,
  country panel, and reporting flow.
- `_worker.js` — Pages advanced-mode Worker for `/api/*`.
- `SKILL.md` and `skill/` — raw agent instructions plus the human-facing
  "Join the Stargazers" page.
- `scripts/check_astra.py` — the downloadable copy of the local checker. Keep
  it byte-for-byte in sync with the root `check_astra.py`.

The API stores reports and stargazer registrations in D1. Three distinct web
reporters or two distinct watcher reports mark a country as lit. Repeated
reports from one salted IP hash are deduplicated; the hash salt is a Cloudflare
secret and is never committed.

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

The value is stored only in Cloudflare. Production report endpoints fail closed
with HTTP 503 until it is present; public status reads remain available.

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
