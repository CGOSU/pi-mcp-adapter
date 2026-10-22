#!/bin/sh
# PI_NATIVE_MCP_UPDATE_HOOK
# Pi managed-update post-hook: the core updater always runs first and keeps its exit status.
case "$0" in
  */*) pi_launcher="$0" ;;
  *) pi_launcher=$(command -v "$0") || exit 127 ;;
esac
while [ -L "$pi_launcher" ]; do
  pi_link=$(readlink "$pi_launcher") || exit 1
  case "$pi_link" in
    /*) pi_launcher="$pi_link" ;;
    *) pi_launcher=${pi_launcher%/*}/$pi_link ;;
  esac
done
pi_bin_dir=${pi_launcher%/*}
pi_agent_dir=${pi_bin_dir%/*}
pi_node_bin=${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin
if [ -x "$pi_node_bin/node" ]; then
  PATH=$pi_node_bin:$PATH
  export PATH
fi
pi_managed_root=$pi_agent_dir/install
pi_original_launcher=$pi_bin_dir/pi.native-mcp-original
if [ ! -x "$pi_original_launcher" ]; then
  printf 'Pi MCP update hook: original Pi launcher is missing; run the hook installer to repair it.\n' >&2
  exit 127
fi

if [ "${1-}" != "update" ]; then
  exec "$pi_original_launcher" "$@"
fi

# Preserve the original updater's command, output, and status. The hook is strictly post-update.
"$pi_original_launcher" "$@"
pi_update_status=$?
if [ "$pi_update_status" -ne 0 ]; then
  exit "$pi_update_status"
fi

pi_hook_root=$pi_managed_root/native-mcp-update
pi_hook_script=$pi_hook_root/managed-pi-update-hook.mjs
# Plan A: resolve the installed adapter package so the hook reads its shipped artifact registry.
# A normal extension update then makes newly supported Pi versions available without reinstalling the hook.
pi_adapter_root=
for pi_candidate in \
  "$pi_agent_dir/git/github.com/CGOSU/pi-mcp-adapter" \
  "$pi_agent_dir/git/github.com/CGOSU/pi-mcp-adapter.git" \
  "$pi_agent_dir/npm/node_modules/pi-mcp-adapter" \
  "$HOME/.pi/agent/git/github.com/CGOSU/pi-mcp-adapter" \
  "$HOME/.pi/agent/npm/node_modules/pi-mcp-adapter"; do
  if [ -f "$pi_candidate/scripts/managed-pi-update-artifacts.json" ]; then
    pi_adapter_root=$pi_candidate
    break
  fi
done
pi_node_bin=${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin
if [ -x "$pi_node_bin/node" ]; then
  pi_hook_node=$pi_node_bin/node
else
  pi_hook_node=$(command -v node) || pi_hook_node=
fi
if [ -n "$pi_hook_node" ]; then
  # Prefer the reconciler shipped by the adapter package so script fixes travel with normal extension
  # updates; the frozen install copy stays as a fallback for hosts without the adapter package.
  if [ -n "$pi_adapter_root" ] && [ -f "$pi_adapter_root/scripts/managed-pi-update-hook.mjs" ]; then
    pi_hook_script=$pi_adapter_root/scripts/managed-pi-update-hook.mjs
  fi
fi
if [ -n "$pi_hook_node" ] && [ -f "$pi_hook_script" ]; then
  if [ -n "$pi_adapter_root" ]; then
    "$pi_hook_node" "$pi_hook_script" --managed-root "$pi_managed_root" --hook-root "$pi_hook_root" --adapter-root "$pi_adapter_root" --after-update -- "$@"
  else
    "$pi_hook_node" "$pi_hook_script" --managed-root "$pi_managed_root" --hook-root "$pi_hook_root" --after-update -- "$@"
  fi
  pi_hook_status=$?
  if [ "$pi_hook_status" -ne 0 ]; then
    printf 'Pi MCP update hook: patch check failed; the completed Pi core update was kept.\n' >&2
  fi
else
  printf 'Pi MCP update hook: reconciler is unavailable; the completed Pi core update was kept.\n' >&2
fi
exit "$pi_update_status"
