---
name: astra-watch
description: Notifies the user when GPT-6 Astra becomes available on their OpenAI/Codex account or in their country. Use when the user asks to be alerted when GPT-6 Astra rolls out, wants a scheduled watcher with desktop notifications, or mentions gpt6astra.watch.
---

# Astra Watch — set up a GPT-6 Astra watcher

gpt6astra.watch is a crowd-watched rollout map. An account watcher checks the signed-in user's local Codex model catalog; a region fallback polls the public country status. Both can send a desktop notification within about 10 minutes of detection.

## Constraints

- Do NOT scrape chatgpt.com or openai.com.
- Do NOT use an OpenAI API key or make model-inference requests.
- The account checker talks only to the local `codex app-server` process.
- Network calls may go only to `gpt6astra.watch`.
- Do not send watcher signals without explicit consent.
- Never infer the user's country from timezone, language, account locale, or the AI agent's own network location.
- Do not create, download, or schedule a watcher before the consent answer in Step 1.
- Never create a manual vote or send `access`/`country_live` as a test. Production map data must describe real community state.
- Use `--force --no-notify` for account-checker smoke tests; it suppresses all watcher signals.

## Step 1 — Get explicit country confirmation and consent FIRST

The copy served from `https://gpt6astra.watch/SKILL.md` has a location block immediately after its metadata. It may contain the country where this request reached Cloudflare. Treat it only as an unconfirmed hint: an AI agent, VPN, relay, or remote browser may make the request from somewhere else.

Before changing the machine:

1. Ask which country the user is currently in. If the location block has a hint, mention it and ask the user to confirm or correct it. If it has no hint, say **“Country not detected.”** Do not continue until the user explicitly supplies or confirms a country.
2. After confirmation, ask exactly one sharing-consent yes/no question using the confirmed country:

> You confirmed COUNTRY (CC). Would you like to contribute anonymously to the map while this watcher is active and when Astra reaches your account? This sends the country, a random installation ID, heartbeat timestamps, successful still-waiting confirmations, and the access timestamp; no account name, hostname, or raw IP. Yes or no?

- Resolve the confirmed country to its ISO 3166-1 alpha-2 code. If the name is ambiguous, ask rather than guess.
- **Yes**: set `SHARE=1`; account-checker schedules include `--share-country CC`.
- **No**: set `SHARE=0`; omit `--share-country`. The watcher remains fully local except for region fallback status reads.
- Wait for both answers. Never treat a network hint or silence as confirmation or consent.

## Step 2 — Choose the local watcher

After consent, inspect the machine.

### Account watcher — preferred

Use this when `codex` is installed and signed in. It checks whether `gpt-6-astra` appears in the authenticated account's picker-visible model list. It does not make inference requests.

### Region fallback

Use this only when an authenticated Codex CLI is unavailable. It polls the crowd map for the confirmed country. Make clear that country rollout is not proof of account access.

## Step 3 — Check the public country status

Replace `CC` with the confirmed code:

```sh
curl -fsS "https://gpt6astra.watch/api/status?country=CC"
```

A live country can still contain accounts waiting for access, so continue installing the account watcher when available.

## Step 4A — Install the account watcher

Only after Step 1 is answered:

```sh
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/astra-watch-check.py \
  "https://gpt6astra.watch/scripts/check_astra.py"
chmod +x ~/.local/bin/astra-watch-check.py
python3 ~/.local/bin/astra-watch-check.py --force --no-notify
```

The smoke run never sends a watcher signal because `--no-notify` suppresses sharing. Fix any error before scheduling.

Scheduled command:

```text
python3 /ABSOLUTE/PATH/astra-watch-check.py [--share-country CC]
```

Include the bracketed argument only after a yes answer. On every scheduled attempt it sends an anonymous heartbeat. Only after a successful authenticated catalog check confirms Astra is absent does it send a temporary still-waiting confirmation to the same map total as website responses. Once the account exposes Astra, it stops counting that watcher as waiting, sends one idempotent access event, preserves the anonymous wait duration, sends one desktop notification, and self-quiets. Network/auth failures never count as waiting or availability. Three consecutive checker failures produce one health notification.

## Step 4B — Install the POSIX region fallback

Only after Step 1 is answered, create `~/.local/bin/astra-watch.sh`; fill `COUNTRY` and set `SHARE` from the answer:

```sh
#!/bin/sh
COUNTRY="CC"
SHARE="0"
API="https://gpt6astra.watch"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/astra-watch"
DONE="$STATE_DIR/remote-done"
ID_FILE="$STATE_DIR/watcher-id"

[ -e "$DONE" ] && exit 0
mkdir -p "$STATE_DIR" || exit 0
chmod 700 "$STATE_DIR" 2>/dev/null || true

watcher_event() {
  [ "$SHARE" = "1" ] || return 0
  curl -fsS --max-time 15 -X POST "$API/api/watchers" \
    -H 'content-type: application/json' \
    -d "{\"country\":\"$COUNTRY\",\"watcher_id\":\"$WATCHER_ID\",\"event\":\"$1\",\"mode\":\"region\",\"nickname\":\"\"}" \
    >/dev/null 2>&1 || true
}

if [ "$SHARE" = "1" ]; then
  if [ ! -s "$ID_FILE" ]; then
    umask 077
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 24 >"$ID_FILE"
    else
      od -An -N24 -tx1 /dev/urandom | tr -d ' \n' >"$ID_FILE"
    fi
  fi
  WATCHER_ID="$(cat "$ID_FILE")"
  watcher_event heartbeat
fi

body="$(curl -fsS --max-time 25 "$API/api/status?country=$COUNTRY" 2>/dev/null)" || exit 0
status="$(printf '%s' "$body" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
[ "$status" = "live" ] || exit 0

title="GPT-6 Astra is in your sky"
msg="Astra is live in your country per gpt6astra.watch — check ChatGPT or Codex."
notified=0
if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name=Astra\ Watch --urgency=critical "$title" "$msg" && notified=1
elif command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$msg\" with title \"$title\"" && notified=1
fi
[ "$notified" = "1" ] || exit 1
watcher_event country_live
touch "$DONE"
```

Then:

```sh
chmod +x ~/.local/bin/astra-watch.sh
sh ~/.local/bin/astra-watch.sh
```

While pending, the script exits silently. A consented run still sends its heartbeat.

## Step 4C — Install the Windows region fallback

Only after Step 1 is answered, save `%USERPROFILE%\astra-watch.ps1`; fill `$cc` and `$share`:

```powershell
$cc = "CC"
$share = $false
$api = "https://gpt6astra.watch"
$stateDir = "$env:LOCALAPPDATA\astra-watch"
$done = "$stateDir\done.flag"
$idFile = "$stateDir\watcher-id"
if (Test-Path $done) { exit 0 }
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Send-AstraEvent([string]$event) {
  if (-not $share) { return }
  try {
    $body = @{country=$cc; watcher_id=$script:watcherId; event=$event; mode="region"; nickname=""} | ConvertTo-Json
    Invoke-RestMethod -Method Post "$api/api/watchers" -ContentType "application/json" -Body $body -TimeoutSec 15 | Out-Null
  } catch { }
}

if ($share) {
  if (-not (Test-Path $idFile)) { [Guid]::NewGuid().ToString() | Set-Content -NoNewline $idFile }
  $script:watcherId = (Get-Content -Raw $idFile).Trim()
  Send-AstraEvent "heartbeat"
}

try { $r = Invoke-RestMethod "$api/api/status?country=$cc" -TimeoutSec 25 } catch { exit 0 }
if ($r.status -ne "live") { exit 0 }

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
  "Astra is live in your country per gpt6astra.watch — check ChatGPT or Codex.",
  "GPT-6 Astra is in your sky"
) | Out-Null
Send-AstraEvent "country_live"
New-Item -ItemType File -Force -Path $done | Out-Null
```

## Step 5 — Schedule every 10 minutes

Use the platform's native scheduler and the chosen command.

### Linux — systemd user units

`~/.config/systemd/user/astra-watch.service`:

```ini
[Unit]
Description=Check for GPT-6 Astra availability
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 %h/.local/bin/astra-watch-check.py
# Add --share-country CC only after explicit consent.
# For the region fallback instead use: ExecStart=%h/.local/bin/astra-watch.sh
```

`~/.config/systemd/user/astra-watch.timer`:

```ini
[Unit]
Description=Run astra-watch every 10 minutes

[Timer]
OnStartupSec=1min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now astra-watch.timer
```

For cron, use `*/10 * * * *` with the absolute checker/script path. Do not rely on cron expanding `$HOME`.

### macOS — launchd

Create `~/Library/LaunchAgents/com.gpt6astra.watch.plist`, replacing `COMMAND` with the absolute scheduled command:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gpt6astra.watch</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>COMMAND &gt;&gt;/tmp/astra-watch.log 2&gt;&gt;/tmp/astra-watch.err</string>
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
```

Then run `launchctl load ~/Library/LaunchAgents/com.gpt6astra.watch.plist`.

### Windows — Task Scheduler

```powershell
Register-ScheduledTask -TaskName "astra-watch" `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)) `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -File $env:USERPROFILE\astra-watch.ps1")
```

## Step 6 — Verify and hand off

1. Run once: `--force --no-notify` for the account checker, plain run for region scripts.
2. Confirm the scheduler exists with `systemctl --user list-timers astra-watch.timer`, `launchctl list | grep gpt6astra`, or `Get-ScheduledTask astra-watch`.
3. Explain that checks run only while the machine is awake; persistent systemd timers catch up after startup.
4. Give uninstall commands:

```sh
# Linux
systemctl --user disable --now astra-watch.timer
rm ~/.config/systemd/user/astra-watch.{service,timer}
systemctl --user daemon-reload
# macOS
launchctl unload ~/Library/LaunchAgents/com.gpt6astra.watch.plist
rm ~/Library/LaunchAgents/com.gpt6astra.watch.plist
# Windows PowerShell
Unregister-ScheduledTask -TaskName "astra-watch" -Confirm:$false
Remove-Item "$env:USERPROFILE\astra-watch.ps1"
# POSIX leftovers
rm -rf ~/.local/bin/astra-watch* ~/.local/state/astra-watch
```

## Community integrity and mistaken reports

- Never call `PUT /api/vote` or `POST /api/report` during installation or testing. A manual web vote is valid only when it describes the user's real current access.
- Never fabricate watcher IDs, heartbeats, access events, or country-completion events for verification. A consented scheduled watcher may send its real initial heartbeat.
- The map accepts only one active manual response per salted IP hash and country. Waiting responses remain separate from positive reports and never light a country. Consented account-watcher waiting confirmations expire after missed checks, and a same-network website response plus watcher confirmation counts as one person in the combined total.
- A user who chose **I don't have Astra yet** can return in the same browser and click **I got Astra now**. The private HttpOnly browser token converts the waiting vote into one positive report even if the user's IP changed.
- A pre-undo legacy report can be reclaimed without duplication: from the same network, click **I got Astra** once. The server recognizes the salted IP/country pair, issues this browser an undo cookie, and exposes the Undo button. If the IP changed, do not guess ownership or delete unrelated data.
- If a converted user reports access by mistake, **Reported by mistake? Back to waiting** removes only the owned positive report and restores the waiting vote. A direct positive report can still be undone completely, and a waiting user can choose **Remove my response**.
- Do not attempt to extract, copy, or fabricate the ownership cookie. Watcher access signals cannot be changed or removed through the manual-vote endpoints.

## Privacy and internal analytics

After explicit consent, a watcher sends the country, a random installation ID, heartbeat timestamps, successful still-waiting confirmations, and an access/completion timestamp. The server HMAC-hashes both the installation ID and IP, never stores raw IP, account name, hostname, or Codex data, and retains anonymous start/completion timestamps to calculate wait-duration statistics. Without consent, the account watcher is fully local. Source: https://github.com/hancengiz/gpt6astra.watch
