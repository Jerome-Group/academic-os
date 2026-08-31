#!/bin/zsh

set -eu
setopt null_glob

cloud_storage_root="${1:-$HOME/Library/CloudStorage}"
volumes_root="${2:-/Volumes}"

roots=(
  "$cloud_storage_root"/GoogleDrive-*/My\ Drive/Modules/Research(N-/)
  "$volumes_root"/*/My\ Drive/Modules/Research(N-/)
)

typeset -a emitted
for root in "${roots[@]}"; do
  for candidate in "$root"/*(N-/); do
    definition="$candidate/00 Project Admin/10 Project Definition.yaml"
    [[ -f "$definition" ]] || continue

    resolved="${candidate:A}"
    (( ${emitted[(Ie)$resolved]} == 0 )) || continue
    emitted+=("$resolved")
    print -r -- "$resolved"
  done
done
