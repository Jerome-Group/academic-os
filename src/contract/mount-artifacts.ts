// What the mount writes into a folder by itself, rather than anything the Owner put there. Finder
// leaves a `.DS_Store` in any directory it displays and writes an `Icon\r` back whenever a custom
// folder icon is set, so a rule that reached them would fail on a folder nobody had done anything
// wrong to — and no delete would settle it, because the next Finder window writes them again.
// Neither reaches Drive: the API inventory never sees them, so this is the mounted reader's alone.
//
// Only a file is ever one of these. `.scratch` is a dot-name the contract requires, so a directory
// stays in the inventory whatever it is called, and an `Icon\r` carrying bytes is content someone
// put there under a name Finder happens to use.
const FINDER_ICON_FILENAME = "Icon\r";

export function isMountArtifact(entry: {
  name: string;
  isFile: boolean;
  size?: number;
}): boolean {
  if (!entry.isFile) return false;
  if (entry.name.startsWith(".")) return true;
  return entry.name === FINDER_ICON_FILENAME && entry.size === 0;
}
