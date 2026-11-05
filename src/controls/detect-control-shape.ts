import { readControls } from "./read-controls.js";
import type { ControlRead, ControlReadInput } from "./types.js";

export function detectControlShape(
  input: ControlReadInput,
): ControlRead["shape"] {
  return readControls(input).shape;
}
