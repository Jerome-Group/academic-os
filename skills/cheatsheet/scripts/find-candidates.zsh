#!/bin/zsh

set -eu
setopt null_glob

module_code="${1:?usage: find-candidates.zsh MODULE_CODE [cloud-root] [volumes-root]}"
cloud_storage_root="${2:-$HOME/Library/CloudStorage}"
volumes_root="${3:-/Volumes}"

[[ "$module_code" =~ '^[A-Z][A-Z0-9]+$' ]] || {
  print -u2 -- "module code must be uppercase letters followed by letters or digits"
  exit 2
}

candidates=(
  "$cloud_storage_root"/GoogleDrive-*/My\ Drive/Modules/*/"$module_code"(N-/)
  "$volumes_root"/*/My\ Drive/Modules/*/"$module_code"(N-/)
)

typeset -a emitted
for candidate in "${candidates[@]}"; do
  [[ -f "$candidate/docs/40 Cheatsheet Procedure.md" ]] || continue
  resolved="${candidate:A}"
  (( ${emitted[(Ie)$resolved]} == 0 )) || continue
  emitted+=("$resolved")
  print -r -- "$resolved"
done
