#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -P "$(dirname "$0")" >/dev/null 2>&1 && pwd)
BIN="$ROOT/bin"
SHIM="$BIN/opencode-unlimited"
MJS="$BIN/opencode-unlimited.mjs"
USER_HOME="${HOME:-$([ -n "${USERPROFILE:-}" ] && printf '%s' "$USERPROFILE")}"
LOCAL_BIN="$USER_HOME/.local/bin"
CONFIG_DIR="$USER_HOME/.config/opencode"
PLUGIN_DST="$CONFIG_DIR/plugins/unlimited-shield.js"

ok() { printf '  [+] %s\n' "$1"; }
bad() { printf '  [x] %s\n' "$1"; exit 1; }
warn() { printf '  [!] %s\n' "$1"; }
info() { printf '      %s\n' "$1"; }

printf '==> opencode-unlimited install\n'

required=(
  "$SHIM"
  "$MJS"
  "$ROOT/lib/proxy-bridge.js"
  "$ROOT/lib/oc-info.js"
  "$ROOT/lib/db-tools.js"
  "$ROOT/lib/session-reid.js"
  "$ROOT/lib/identity.js"
  "$ROOT/lib/egress.js"
  "$ROOT/lib/log-watch.js"
  "$ROOT/lib/proxy-health.js"
  "$ROOT/lib/model-switch.js"
)
for file in "${required[@]}"; do
  if [ ! -f "$file" ]; then
    bad "missing build artifact: $file"
  fi
done
ok "build artifacts present"

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  warn "node not found: session tools and identity helpers stay unavailable"
fi

chmod +x "$SHIM"

mkdir -p "$LOCAL_BIN"
ln -sfn "$SHIM" "$LOCAL_BIN/opencode-unlimited"
ok "linked $LOCAL_BIN/opencode-unlimited -> $SHIM"

case ":${PATH:-}:" in
  *":$LOCAL_BIN:"*)
    info "already on PATH: $LOCAL_BIN"
    ;;
  *)
    case "${SHELL:-}" in
      */bash) RC="$USER_HOME/.bashrc" ;;
      */zsh) RC="$USER_HOME/.zshrc" ;;
      *) RC="$USER_HOME/.profile" ;;
    esac
    PATH_LINE='case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac'
    touch "$RC"
    if ! grep -qF "$PATH_LINE" "$RC"; then
      printf '\n%s\n' "$PATH_LINE" >> "$RC"
      ok "added ~/.local/bin to PATH in $RC"
      info "open a new terminal to pick it up"
    else
      info "already on PATH in $RC"
    fi
    ;;
esac

if [ -f "$PLUGIN_DST" ]; then
  warn "an old flat plugin copy is present: $PLUGIN_DST"
  info "the current layout is a folder, install it with: opencode-unlimited plugin install"
  info "remove the old file with: opencode-unlimited off"
else
  ok "plugin not installed (run 'opencode-unlimited on' or 'plugin install' when you want it)"
fi

printf '\n'
printf '  next:\n'
info "opencode-unlimited version    tool plus the detected opencode version"
info "opencode-unlimited usage      what the meter is doing today"
info "opencode-unlimited reset .    new device id, new session ids, nothing lost"
info "opencode-unlimited model      providers you can switch to"
info "opencode-unlimited status     runtime, identity, network, ledger"
info "opencode-unlimited doctor     node, service, schema, plugin, egress"
info "opencode-unlimited proxy set socks5://127.0.0.1:1080   optional IP path"
printf '\n'
ok "installed"
exit 0
