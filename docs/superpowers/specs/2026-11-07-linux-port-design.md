# Linux Port of OpenCode-Unlimited — Design

Date: 2026-11-07
Status: Approved (Node CLI chosen)

## 1. Goal

Port the `OpenCode-Unlimited` command-line tool from a Windows/PowerShell implementation to a Linux-native one that builds from the same repo, reuses every existing JS library untouched, and runs the same 24 subcommands with identical behavior and state files.

## 2. Architecture

The existing project already splits the work cleanly:

- `lib/*.js` — 8 pure-Node helpers (`db-tools`, `egress`, `identity`, `log-watch`, `model-switch`, `oc-info`, `proxy-bridge`, `proxy-health`), called as `node <helper> <args>` returning JSON. **Mostly cross-platform, but three files carry Windows-first path assumptions** that need small additive fixes (see §3 "Library fixes").
- `plugins/unlimited-shield.js` — pure-Node plugin. **Cross-platform already.**
- `bin/opencode-unlimited.ps1` (2,753 lines) — the PowerShell dispatcher. This is the main platform-specific logic.
- `install.ps1`, `scripts/release.ps1` — Windows install/release tooling.

The Linux port therefore:

1. Reimplements the dispatcher as a Node CLI: `bin/opencode-unlimited.mjs`.
2. Adds a zero-dependency shell shim `bin/opencode-unlimited` (`#!/bin/sh` → `exec node .../opencode-unlimited.mjs "$@"`) so `opencode-unlimited` is on PATH.
3. Adds a Linux installer `install.sh`.
4. Adds a systemd user unit for the background watcher (`WantedBy=default.target`, mirroring the Windows logon scheduled task).
5. Keeps `bin/opencode-unlimited.cmd` and all `.ps1` intact so Windows still works.

## 3. Platform mapping (Windows → Linux)

### Library fixes (minimal, additive)

Three libs hardcode Windows path assumptions. The port makes the smallest changes that keep Linux working and leave Windows behavior identical:

- `lib/oc-info.js` — `exeCandidates()` splits `PATH` on `";"` and only looks for `opencode.exe/.cmd/.bat`. Add `"opencode"` (extensionless) to the file list and split on `require("node:path").delimiter` (":" on Linux, ";" on Windows) so a Linux `opencode` on PATH is found subjective. Windows behavior is unchanged (":" is never a valid `;`-split on Windows, and the `.exe` list is retained).
- `lib/identity.js` — the shim dir falls back to `AppData/Local`. Add a Linux fallback (`~/.local/share/opencode-unlimited/shim`) when neither `LOCALAPPDATA` nor a Windows home is detected.
- `lib/model-switch.js` — `models.json` / `auth.json` fallback dir is `AppData/Local`. Add a Linux data-dir fallback (`~/.local/share/opencode`).

| Windows | Linux |
|---|---|
| `~/.config/opencode`, `~/.local/share/opencode` | unchanged (already XDG-correct) |
| `Register-ScheduledTask` / `schtasks` logon task `OpenCodeUnlimitedWatch` | `systemd --user` unit `opencode-unlimited-watch.service`, `WantedBy=default.target`, exec `node cli watch -follow -auto` |
| `Start-Process -WindowStyle Hidden` (bridge) + pidfile | `child_process.spawn(..., {detached:true, stdio:'ignore'})` + pidfile; process-liveness via `process.kill(pid, 0)` |
| `opencode.exe` resolution (`%APPDATA%`, scoop, choco) | `which opencode` + `~/.opencode/bin/opencode`, `~/.local/bin/opencode`, `~/.bun/bin/opencode`, `~/.npm-global/bin/opencode`, `~/.nvm/current/bin/opencode` |
| DB candidates incl. `%LOCALAPPDATA%\opencode\...` | `~/.local/share/opencode/opencode.db` and `opencode.sqlite` |
| Slash-command template `!powershell -File "…ps1" <cmd>` | `!node …/opencode-unlimited.mjs <cmd> "$ARGUMENTS"` |
| PATH write via `HKCU:\Environment` | append `export PATH=…` to `~/.bashrc` / `~/.zshrc`; symlink into `~/.local/bin` |
| `Invoke-WebRequestRaw` (System.Net.WebRequest) | `fetch` / `curl` (libs already do this) |
| `Get-UserAgent` (OpenCode UA string) | identical constant |
| Node ≥ 22.5 SQLite gate | same check via `process.versions.node` |

## 4. Command surface

Port all 24 dispatch-table entries from `opencode-unlimited.ps1:2726`:

`install reset clear verify identity block usage watch hunt token status sessions model reid version on off proxy plugin warp run doctor uninstall` (plus `-v`, `--version`, and default `help`).

Each maps to a function in `opencode-unlimited.mjs` with the same name/logic. Flag parsing (`-Dry`, `-KeepIds`, `-KeepId`, `-NoProbe`, `-NoStart`, `-KeepRoute`, `-Hunt`, `-Force`, `-Top N`, `-Country`, `-Prefix`, `-Follow`, `-Auto`, `-All`) is preserved case-insensitively, and position/flag-value extraction (`Get-PathArg`, `Get-RestFlag`, `Get-RestInt`) is replicated.

## 5. State & file compatibility

Byte-for-byte compatible with the Windows state files (same paths, same JSON shapes) so a pool/identity travels across machines:

- `~/.config/opencode/unlimited.json` — config
- `~/.config/opencode/unlimited-ip.json`, `unlimited-pool.json`, `unlimited-rotate.json`
- `~/.config/opencode/unlimited-bridge.pid`, `unlimited-watch.pid`, `unlimited-bridge.log`, `unlimited-watch.log`
- `~/.config/opencode/identity.json` — virtual device identity
- `~/.config/opencode/plugins/unlimited-shield/index.js` — plugin
- `~/.config/opencode/unlimited-shield.state.json` — plugin marker
- `~/.local/share/opencode/auth.json`; `~/.local/share/opencode-unlimited/auth-snapshot/auth.json`

Output text is kept byte-identical (`[+]`, `[!]`, `[x]`, `      ` indents, section headers `[1/6]` etc.).

## 6. Error handling

- Node ≥ 22.5 gate enforced for SQLite-touching commands (`reid`, `verify`, `sessions`, `reset`, `doctor`); others degrade gracefully with a warning, same as Windows.
- `curl` optional: egress trace falls back to `fetch` when `curl` is absent.
- Detached child spawn failures surface through the same pidfile + "bridge exited" path.
- `systemd --user` daemon-ize: the watcher is started as a normal detached child (`spawn` + `disconnect` + pidfile), matching Windows; the `.service` file is the autostart-at-logon mechanism. No `daemon()` helper needed.

## 7. Testing

- Node version gate: `node --version` → `v22.22.0` present.
- Run `node bin/opencode-unlimited.mjs version` and `usage` — must execute without the PowerShell host.
- Run `node bin/opencode-unlimited.mjs help` — dispatch table renders.
- Live-verify the shim: `./bin/opencode-unlimited version`.
- Shellcheck-clean `install.sh`; `sh -n bin/opencode-unlimited`.
- Confirm `reset -Dry` walks all six steps without writing state.

## 8. Out of scope

- No new features; a 1:1 behavior port only.
- Only the three additive Linux-compat fixes in §3 to `lib/oc-info.js`, `lib/identity.js`, `lib/model-switch.js`; no behavioral rewrites.
- Windows (`bin/*.cmd`, `install.ps1`, `scripts/release.ps1`) left untouched.
- The `opencode-free-provider` fingerprint-injection reference repo is **not** incorporated into this port.