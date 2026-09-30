# Command-line tool (headless mode)

MetaDash can run without opening its window. The app binary started with `--cli` syncs data, writes reports and exports, and prints status. You can use it in scripts and scheduled jobs, for example to email last month's PDF reports on the 1st of each month.

- The CLI uses the same database, connections, branding and report templates as the app. Nothing is set up separately.
- It can run while the app is open. Only one sync runs at a time: if the app is syncing, `metadash sync` exits with code 5, and the app shows "running from the command line" while the CLI syncs.
- Tokens and secrets are never printed, not even with `--json`.

## Running it

The app binary itself is the command-line tool. Start it with `--cli` followed by a command:

| OS | Command (default install location) |
|---|---|
| macOS | `/Applications/MetaDash.app/Contents/MacOS/MetaDash --cli <command>` |
| Windows | `"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe" --cli <command>` |
| Linux (deb) | `/opt/MetaDash/metadash --cli <command>` |
| Linux (AppImage) | `./MetaDash-<version>-linux-x86_64.AppImage --cli <command>` |
| Development | `npm run cli -- <command>` (same as `electron . --cli <command>`) |

Without `--cli` the binary opens the normal app window.

### The `metadash` command

**Settings → Command-line tool → Install metadash command** writes a small script so you can type `metadash <command>`:

- **macOS:** `/usr/local/bin/metadash`. If that folder is not writable, the script goes to `~/.local/bin/metadash` instead.
- **Linux:** `~/.local/bin/metadash`.
- **Windows:** `%LOCALAPPDATA%\MetaDash\bin\metadash.cmd`. Add that folder to your user PATH (Settings → System → About → Advanced system settings → Environment Variables), then open a new terminal.

You can also install the script into another folder (absolute path). The section shows whether the folder is on your PATH. **Remove** deletes only files MetaDash created. The script just runs `"<app binary>" --cli "$@"`, so it keeps working after app updates as long as the app stays in the same place.

The rest of this page writes `metadash`. Replace it with the full command from the table above if you did not install the script.

## Commands

Every command accepts `--help`, for example `metadash report --help`. `metadash help` lists all commands.

### Global options

| Option | Meaning |
|---|---|
| `--json` | Machine-readable output: one JSON document on stdout. Progress and messages go to stderr. |
| `-q`, `--quiet` | No progress lines on stderr. Errors are still printed. |
| `--lang <code>` | Language for messages and reports (`en`, `tr`, `de`, `es`). The default is the app language. |
| `--user-data <dir>` | Use another data folder, e.g. a copy of the database. |
| `--log-file <file>` | Append all output, including results, to a file with timestamps. Recommended on Windows and in scheduled jobs. |
| `-v`, `--version` | App version. |

### `metadash accounts`

Lists tracked accounts with their **key**, platform, @username, name, client, followers and last sync time.

```sh
metadash accounts
metadash accounts --platform instagram,fb --client "Acme" --json
metadash accounts --tag Retail --search coffee --all   # --all includes untracked accounts
```

Other commands accept accounts as:

- `@username`
- `platform:@username`. Aliases: `ig`, `fb`, `th`, `yt`, `tt`.
- The account key: `1784…` (Instagram), `fb-…`, `th-…`, `yt-…`, `tt-…`.

A plain word that is not a key is tried as a username. If a username exists on several platforms, the command exits with code 2 and lists the candidates.

### `metadash sync`

Fetches fresh data, the same as **Refresh** in the app, and waits until it finishes. Progress lines (`[done/total] phase account`) go to stderr.

```sh
metadash sync                                   # everything
metadash sync --scope organic --platform instagram,threads
metadash sync --scope ads
metadash sync --account @brand --account fb:@brand
metadash sync --client "Acme" --json
```

| Option | Values |
|---|---|
| `--scope` | `full` (default), `organic`, `ads`, `stories`, `competitors`, `inbox` |
| `--platform` | Only these platforms (comma-separated or repeated) |
| `--account`, `--client`, `--tag` | Only these accounts (repeatable) |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | The sync finished without errors. |
| 3 | The sync finished, but some jobs failed. The errors are printed. |
| 4 | A connection must be reconnected in the app (token expired, revoked or missing), or nothing is connected. |
| 5 | Another sync is running, in the app or in another CLI process. |
| 6 | Read-only shared team workspace. |

With demo data no API calls are made, and the demo dataset moves forward by a day.

### `metadash report`

Writes the same reports as **Reports → Export**: same templates, sections, branding and PDF rendering. The PDF is printed from a hidden window, exactly as in the app.

```sh
# Last month's report for one account (PDF, format from the extension)
metadash report --template monthly --account @brand --out ~/Reports/brand.pdf

# One file per account of a client; tokens are replaced per file
metadash report -t monthly --client "Acme" --period last_month \
  --out "~/Reports/{client}/{account}-{platform}-{from}.pdf"

# Weekly portfolio of accounts tagged "Retail", Instagram only, as Excel
metadash report -t portfolio --tag Retail --platform instagram --period last_week --out retail-{date}.xlsx

# Custom range in Turkish, only some sections, with an AI commentary draft
metadash report -t custom --account ig:@brand --from 2026-01-01 --to 2026-03-31 \
  --lang tr --sections kpis,reach,posts --commentary ai --out q1.html
```

| Option | Values |
|---|---|
| `-t`, `--template` | `monthly`, `weekly_client`, `custom`, `campaign` (these need accounts), `portfolio`, `weekly` (these cover all accounts, filtered by `--tag` / `--platform`) |
| `--account`, `--client`, `--tag` | Account selection (repeatable). `campaign` covers one account per file. |
| `--platform` | Portfolio / weekly filter, or narrows the selected accounts |
| `--period` | `today`, `yesterday`, `last_7d`, `last_14d`, `last_28d`, `last_30d`, `last_90d`, `this_week`, `last_week`, `this_month`, `last_month` |
| `--from`, `--to` | Explicit range, `YYYY-MM-DD`. Wins over `--period`. |
| `--format` | `pdf`, `html`, `xlsx`. The default comes from the `--out` extension, otherwise `pdf`. |
| `--sections` / `--exclude-sections` | Keep only these sections, or drop some (names as in `--help`, e.g. `kpis`, `reach`, `posts`, `ads`) |
| `--commentary` | `none` (default) or `ai`: a draft from the AI provider set up in the app. If it fails, the report is written without commentary. |
| `--commentary-file` | Commentary text read from a file |
| `--cover-title` | Cover title |
| `-o`, `--out` | Output file. Missing folders are created. Tokens: `{account}` `{platform}` `{client}` `{template}` `{from}` `{to}` `{date}` (today) `{format}` |

Without `--period` or `--from/--to`, `monthly` covers last month, `weekly_client` and `weekly` the last 7 days, and `portfolio` and `campaign` the last 30 days. `custom` always needs a period. `last_Nd` means the last N days including today, the same as in the app. `last_week` (Monday to Sunday) and `last_month` are complete periods, so they are the right choice for scheduled reports.

With `{account}` in `--out`, one file is written per selected account. Without it, all accounts go into one multi-account report. If a client has the same username on two platforms, add `{platform}` so the file names differ. The command exits with code 2 before writing anything if two files would collide.

Exit codes: 0 all files written, 2 wrong arguments, 3 some files failed, 1 all failed.

### `metadash export` and `metadash backup`

```sh
metadash export list                                        # built-in queries
metadash export csv  --query media --out media.csv
metadash export csv  --query accounts --out - | head        # CSV on stdout
metadash export csv  --sql "SELECT username, followers FROM accounts a JOIN account_snapshots s USING (ig_id)" --out f.csv
metadash export xlsx --query accounts,media,snapshots --out metadash-{date}.xlsx
metadash backup --out ~/Backups/metadash.metadash
MD_PASS='…' metadash backup --out backup.metadash --passphrase-env MD_PASS
```

- The built-in queries are `accounts`, `media`, `account_insights`, `snapshots`, `stories`, `ads`, `competitors` and `sync_errors`, the same as the Settings export presets.
- `--sql` accepts only read-only queries (`SELECT` / `WITH`).
- CSV files are UTF-8 with a BOM, so Excel opens them correctly.
- `backup` is the same file as **Settings → Transfer**. Tokens and app secrets are left out unless `--passphrase-env` names an environment variable that holds a passphrase; they are then encrypted with it. Never put the passphrase itself on the command line.

### `metadash status`

Shows:

- The last sync and the last successful sync.
- Whether a sync is running right now, and who started it (app or CLI).
- Each connection's token health: `ok`, `expiring` (less than 7 days), `expired`, `missing`, `demo`. YouTube and TikTok connections renew their tokens on their own and show `ok`.
- Tracked accounts per platform.
- API quota used today (YouTube).
- The publish worker and the team workspace.

`metadash status --check` exits with code 4 when a connection is expired, missing or unreadable, or when nothing is connected. Use it in monitoring scripts.

### Other commands

`metadash inbox …`, `metadash worker …` and `metadash team …` belong to the unified inbox, the publish worker and team features. See [inbox.md](inbox.md), [worker.md](worker.md) and [team.md](team.md).

## Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | OK | Success |
| 1 | ERROR | Unexpected failure (the message is printed) |
| 2 | USAGE | Wrong arguments, unknown command or account, ambiguous account (candidates printed) |
| 3 | PARTIAL | Finished with some errors |
| 4 | AUTH | Reconnect needed or nothing connected |
| 5 | LOCKED | A sync is already running (app or another CLI) |
| 6 | READ_ONLY | Shared read-only team workspace; commands that change data are disabled |
| 7 | NOT_IMPLEMENTED | Not available in this version |

## Scheduling

Every example below runs a full sync at 06:00 and writes last month's client reports on the 1st of the month. Each job waits for the sync to finish. If the app is syncing at that moment, the job exits with code 5; run it again later or ignore that code.

### cron (macOS / Linux)

`crontab -e`:

```cron
# m h dom mon dow
0 6 * * *  /usr/local/bin/metadash sync --quiet --log-file "$HOME/metadash-cli.log"
30 6 1 * * /usr/local/bin/metadash report -t monthly --client "Acme" --period last_month --out "$HOME/Reports/{client}/{account}-{platform}-{from}.pdf" --quiet --log-file "$HOME/metadash-cli.log"
```

cron's PATH is minimal, so use the full path of the script or of the app binary. On macOS, writing into Documents or Desktop from cron may require **Full Disk Access** for `/usr/sbin/cron`; launchd (below) is usually simpler.

### launchd (macOS)

`~/Library/LaunchAgents/com.metadash.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.metadash.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/MetaDash.app/Contents/MacOS/MetaDash</string>
    <string>--cli</string>
    <string>sync</string>
    <string>--quiet</string>
    <string>--log-file</string>
    <string>/Users/you/Library/Logs/metadash-cli.log</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
```

Load it with `launchctl load ~/Library/LaunchAgents/com.metadash.sync.plist`. launchd runs a missed job when the Mac wakes up. For the monthly report, add a second agent with `<key>Day</key><integer>1</integer>` in `StartCalendarInterval` and the `report` arguments.

### Task Scheduler (Windows)

The Windows app is a GUI program, so its console output may not appear in `cmd.exe`. Scheduled tasks should always use `--out` for files and `--log-file` for messages.

```bat
schtasks /Create /TN "MetaDash sync" /SC DAILY /ST 06:00 ^
  /TR "\"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe\" --cli sync --quiet --log-file \"%USERPROFILE%\metadash-cli.log\""

schtasks /Create /TN "MetaDash monthly reports" /SC MONTHLY /D 1 /ST 06:30 ^
  /TR "\"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe\" --cli report -t monthly --client Acme --period last_month --out \"%USERPROFILE%\Reports\{account}-{platform}-{from}.pdf\" --log-file \"%USERPROFILE%\metadash-cli.log\""
```

In a batch file, check `%ERRORLEVEL%` after the command, using the exit codes above.

## Headless Linux servers

PDF reports are printed by Chromium, so Electron needs a display even though no window is shown. On a server without one:

- Run under a virtual display: `xvfb-run -a metadash report … --format pdf` (package `xvfb`).
- Or try Chromium's headless mode: `metadash --ozone-platform=headless --cli report …` (Electron 33; not supported on every distribution).
- HTML and Excel reports, `sync`, `export`, `accounts` and `status` still need Electron to start. If a command fails to start without a display, use `xvfb-run -a` as well.

The data folder is `~/.config/MetaDash`. Use `--user-data <dir>` to point at a copy.

## Development

- `npm run cli -- status` runs the CLI from the source tree.
- `node scripts/cli-smoke.mjs` seeds demo data into a temporary folder and runs every command end to end, including a real PDF. It uses `xvfb-run` on Linux when no display is set. Add `--keep` to keep the files.
- Tests: `tests/cli.args.test.js` (parsing, resolution, exit codes), `tests/cli.commands.test.js` (commands against a seeded demo database), `tests/cli.sync.integration.test.js` (lease conflict, invalid token against a fake Graph API), `tests/cli.shim.test.js`.
- Code: `src/main/cli/` (`index.js` command table and global options, `output.js`, `resolve.js`, `args.js`, `shim.js`, `commands/*.js`) and `src/main/export/params.js` (period presets and report parameters, mirroring the Reports page).
