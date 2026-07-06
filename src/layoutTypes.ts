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

// Layout files written before `canvas.gridSize` was introduced won't have it;
// backfill so downstream code can always rely on the field being present.
// Similarly, panels used to carry a single `binding` field before a panel
// could bind to multiple interfaces — migrate it into `bindings` on load.
export function parseLayoutDocumentText(text: string): LayoutDocument {
  const trimmed = text.trim();
  if (!trimmed) { return emptyLayoutDocument(); }
  try {
    const doc = JSON.parse(trimmed) as LayoutDocument;
    if (!doc.canvas.gridSize) { doc.canvas.gridSize = emptyLayoutDocument().canvas.gridSize; }
    doc.panels = doc.panels.map(normalizePanelBindings);
    return doc;
  } catch {
    return emptyLayoutDocument();
  }
}

function normalizePanelBindings(panel: LayoutPanel): LayoutPanel {
  if (Array.isArray(panel.bindings)) { return panel; }
  const { binding, ...rest } = panel as LayoutPanel & { binding?: FocusEntry | null };
  return { ...rest, bindings: binding ? [binding] : [] };
}
