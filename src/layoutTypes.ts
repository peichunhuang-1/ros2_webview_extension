import type { FocusEntry } from './focusStore';

export interface LayoutPanel {
  id:      string;
  label:   string;
  x:       number;
  y:       number;
  width:   number;
  height:  number;
  bindings: FocusEntry[];
  image?:  string;
  notes?:  string;
  // Stacking order among overlapping panels — higher draws on top. Optional
  // so older layout files without it still parse; treat as 0 when absent.
  layer?:  number;
}

export interface LayoutDocument {
  version: 1;
  canvas:  { width: number; height: number; gridSize: number };
  panels:  LayoutPanel[];
}

export function emptyLayoutDocument(): LayoutDocument {
  return { version: 1, canvas: { width: 1280, height: 800, gridSize: 40 }, panels: [] };
}
