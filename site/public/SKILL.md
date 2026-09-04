---
name: astra-watch
description: Notifies the user when GPT-6 Astra becomes available on their OpenAI/Codex account or in their country. Use when the user asks to be alerted when GPT-6 Astra rolls out to them, wants a scheduled watcher with desktop notifications, or mentions gpt6astra.watch.
---

# Astra Watch — set up a GPT-6 Astra watcher

gpt6astra.watch is the crowd-watched rollout map for GPT-6 Astra. It has two signals:

- **The map** (crowd signal): humans click "I got Astra" on a country. No proof, just social signal.
- **A watcher** (ground truth): a scheduled job on the user's own machine that checks whether `gpt-6-astra` is visible in the model catalog of *their signed-in Codex account*, and fires a desktop notification when it appears.

Your job when this skill is invoked: install a watcher **on this machine** that notifies the user within ~10 minutes of availability.

## Constraints

- Do NOT scrape chatgpt.com or openai.com.
- Do NOT use an OpenAI API key or make model inference requests.
- The ground-truth checker talks only to the local `codex app-server` process (documented protocol).
- The only network calls you may make go to `gpt6astra.watch`.
- Never report the user's country to the map without their explicit consent (Step 4).

## Step 1 — Determine the country

Determine the user's ISO 3166-1 alpha-2 code (`CC`, e.g. `DE`, `TR`, `US`, `JP`). Ask them, or infer from their timezone. It is used only for the public map and the waiting counter.

## Step 2 — Check current status once

```sh
curl -fsS "https://gpt6astra.watch/api/status?country=CC"
```

- `"status":"live"` → their country is widely lit; their *account* may still be waiting — install the watcher anyway.
- `"status":"pending"` → install the watcher.

## Step 3 — Register on the waiting counter (optional)

```sh
curl -fsS -X POST "https://gpt6astra.watch/api/watchers" \
  -H 'content-type: application/json' \
  -d '{"country":"CC","nickname":""}'
```

Harmless: bumps the "stargazers waiting" count for their country. Skip if the user objects. (The empty `nickname` field is an anti-bot honeypot — keep it empty.)

## Step 4 — Consent for report-back (REQUIRED)

Ask the user exactly this:

> When your account gets Astra, should the watcher report your country to the public map? Only the 2-letter country code and the word "watcher" are sent — nothing else.

- **Yes** → pass `--report-country CC` to the checker (Step 5A) or set `REPORT=1` in the fallback script (5B).
- **No, or no answer** → omit it entirely. Never send it silently.

## Step 5 — Pick the watcher implementation

### 5A. Codex CLI installed — PREFERRED (ground truth)

Works if `codex` is on PATH and the user is signed in.

```sh
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/astra-watch-check.py \
  "https://gpt6astra.watch/scripts/check_astra.py"
chmod +x ~/.local/bin/astra-watch-check.py
python3 ~/.local/bin/astra-watch-check.py --force --no-notify
```

The test run prints JSON: `{"status":"absent",...}` (not yet), `{"status":"available",...}` (already there — tell the user and stop), or an error (fix before scheduling).

Scheduled command (Step 6):

```
python3 /home/USER/.local/bin/astra-watch-check.py [--report-country CC]
```

The script: sends one desktop notification, stores state in `~/.local/state/astra-watch/`, never treats network/auth failures as "unavailable", self-quiets after notifying, and after three consecutive failures sends one health notification. It uses `notify-send` on Linux, `osascript` on macOS, and PowerShell on Windows.

### 5B. Fallback — remote watcher (any OS, no Codex needed)

Polls the crowd map instead of the account. Create `~/.local/bin/astra-watch.sh` with `CC` filled in and `REPORT` per the consent answer:

```sh
#!/bin/sh
# astra-watch — remote watcher for gpt6astra.watch
COUNTRY="CC"                      # ISO 3166-1 alpha-2
REPORT="0"                        # 1 = report country to the map on detection (consent only!)
API="https://gpt6astra.watch"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/astra-watch"
STATE="$STATE_DIR/remote-done"

[ -e "$STATE" ] && exit 0

body="$(curl -fsS --max-time 25 "$API/api/status?country=$COUNTRY" 2>/dev/null)" || exit 0
status="$(printf '%s' "$body" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)"
[ "$status" = "live" ] || exit 0

title="GPT-6 Astra is in your sky"
msg="Astra is live in your country per gpt6astra.watch — check ChatGPT or Codex."
if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name=Astra\ Watch --urgency=critical "$title" "$msg"
elif command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$msg\" with title \"$title\""
fi

if [ "$REPORT" = "1" ]; then
  curl -fsS --max-time 15 -X POST "$API/api/report" \
    -H 'content-type: application/json' \
    -d "{\"country\":\"$COUNTRY\",\"source\":\"watcher\",\"nickname\":\"\"}" >/dev/null 2>&1
fi

mkdir -p "$STATE_DIR" && touch "$STATE"
```

`chmod +x ~/.local/bin/astra-watch.sh`, then test-run it once (`sh ~/.local/bin/astra-watch.sh` — exits silently while pending).

## Step 6 — Schedule every 10 minutes

Use the platform's native scheduler. Ground-truth checker = the python command from 5A; fallback = the `.sh` from 5B.

**Linux — systemd user units** (recommended):

`~/.config/systemd/user/astra-watch.service`:
```ini
[Unit]
Description=Check for GPT-6 Astra availability
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 %h/.local/bin/astra-watch-check.py
# append --report-country CC here if the user consented
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

Then: `systemctl --user daemon-reload && systemctl --user enable --now astra-watch.timer`

**Linux fallback — cron**: `crontab -e` → `*/10 * * * * /usr/bin/python3 $HOME/.local/bin/astra-watch-check.py` (cron does not expand `$HOME` — write the absolute path).

**macOS — launchd**: `~/Library/LaunchAgents/com.gpt6astra.watch.plist` (replace `ABSPATH` with the real absolute path):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gpt6astra.watch</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>ABSPATH >/tmp/astra-watch.log 2>/tmp/astra-watch.err</string>
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
```
Then: `launchctl load ~/Library/LaunchAgents/com.gpt6astra.watch.plist`

**Windows — Task Scheduler** (PowerShell, run as the user). First save the PowerShell watcher as `%USERPROFILE%\astra-watch.ps1` with `CC`/`$report` filled per consent:

```powershell
$cc = "CC"; $report = $false
$r = Invoke-RestMethod "https://gpt6astra.watch/api/status?country=$cc" -TimeoutSec 25
if ($r.status -ne "live") { exit 0 }
$done = "$env:LOCALAPPDATA\astra-watch\done.flag"
if (Test-Path $done) { exit 0 }
New-Item -ItemType Directory -Force -Path (Split-Path $done) | Out-Null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName("text")
$x.Item(0).AppendChild($t.CreateTextNode("GPT-6 Astra")) | Out-Null
$x.Item(1).AppendChild($t.CreateTextNode("Astra is live in your country - check ChatGPT or Codex.")) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))
if ($report) {
  Invoke-RestMethod -Method Post "https://gpt6astra.watch/api/report" -ContentType "application/json" `
    -Body (@{country=$cc; source="watcher"; nickname=""} | ConvertTo-Json) | Out-Null
}
New-Item -ItemType File -Path $done | Out-Null
```

Then register the schedule:

```powershell
Register-ScheduledTask -TaskName "astra-watch" `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)) `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -File $env:USERPROFILE\astra-watch.ps1")
```

## Step 7 — Verify and hand off

1. Run the check once (`--force --no-notify` for the python checker, plain run for scripts) and show the user the JSON result.
2. Confirm the schedule exists: `systemctl --user list-timers astra-watch.timer` / `launchctl list | grep gpt6astra` / `Get-ScheduledTask astra-watch`.
3. Tell the user: checks only run while the machine is awake (missed systemd runs catch up on next boot — `Persistent=true`).
4. Give them the uninstall commands:

```sh
# Linux (systemd)
systemctl --user disable --now astra-watch.timer
rm ~/.config/systemd/user/astra-watch.{service,timer} && systemctl --user daemon-reload
# macOS
launchctl unload ~/Library/LaunchAgents/com.gpt6astra.watch.plist && rm ~/Library/LaunchAgents/com.gpt6astra.watch.plist
# Windows (PowerShell)
Unregister-ScheduledTask -TaskName "astra-watch" -Confirm:$false; Remove-Item "$env:USERPROFILE\astra-watch.ps1"
# All: remove leftovers
rm -rf ~/.local/bin/astra-watch* ~/.local/state/astra-watch
```

## Privacy

The watcher sends: the 2-letter country code, and (ground-truth mode) nothing else — report-back happens once, only if consented, and the site stores only country + timestamp + a salted one-way IP hash. Full source: https://github.com/hancengiz/gpt6astra.watch
