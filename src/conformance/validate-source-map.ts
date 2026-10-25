import { readSourceMap } from "./source-map.js";
import type { Finding } from "./types.js";

export function validateSourceMap(source: string | undefined): Finding {
  return readSourceMap(source).finding;
}
