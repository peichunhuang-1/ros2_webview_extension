import type { FocusEntry, LayoutDocument, LayoutPanel } from '../../ros2_apis/bridge_types';

// Pure model/geometry logic for the layout editor: canvas constants, snapping
// math, and panel-array transforms. Nothing in here touches React or the DOM,
// so it can be read (and changed) without tracing through component state.

export const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
export type Handle = typeof HANDLES[number];
export type DragMode = 'move' | Handle;

export const DEFAULT_GRID_SIZE = 40;
export const MIN_CANVAS_SIZE = 200;
export const MIN_GRID_SIZE = 4;
// Screen-space distance a pointer must travel before a press counts as a
// drag rather than a click — without this, the tiny jitter between the two
// clicks of a double-click nudges the panel and the edit modal never opens.
export const DRAG_THRESHOLD_PX = 4;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.25;
export const CANVAS_PAD = 24;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// Screen-space distance within which a dragged/resized edge snaps to a
// guide (canvas center or another panel's edge/center). Converted to
// canvas-space by dividing by the current display scale, so the snap feels
// like a constant distance under the pointer regardless of zoom level.
export const SNAP_THRESHOLD_SCREEN_PX = 6;

export type SnapLine = { axis: 'x' | 'y'; pos: number };

// Vertical guides are candidate x-positions (canvas center + other panels'
// left/center/right edges); horizontal guides are the y equivalent.
export function collectSnapCandidates(doc: LayoutDocument, excludeId: string): { x: number[]; y: number[] } {
  const x = [doc.canvas.width / 2];
  const y = [doc.canvas.height / 2];
  for (const p of doc.panels) {
    if (p.id === excludeId) { continue; }
    x.push(p.x, p.x + p.width / 2, p.x + p.width);
    y.push(p.y, p.y + p.height / 2, p.y + p.height);
  }
  return { x, y };
}

// Finds the single closest (edge, candidate) pair within `threshold` and
// returns the delta needed to align that edge exactly to the candidate,
// plus which candidate positions ended up aligned (for guide-line display).
export function snapAxis(edges: number[], candidates: number[], threshold: number): { delta: number; lines: number[] } {
  let bestDelta = 0;
  let bestAbs = threshold;
  for (const edge of edges) {
    for (const cand of candidates) {
      const d = cand - edge;
      if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); bestDelta = d; }
    }
  }
  if (bestAbs >= threshold) { return { delta: 0, lines: [] }; }
  const lines = new Set<number>();
  for (const edge of edges) {
    const shifted = edge + bestDelta;
    for (const cand of candidates) {
      if (Math.abs(shifted - cand) < 0.5) { lines.add(cand); }
    }
  }
  return { delta: bestDelta, lines: [...lines] };
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function panelLayer(p: LayoutPanel): number {
  return p.layer ?? 0;
}

export function topLayer(panels: LayoutPanel[]): number {
  return panels.reduce((m, p) => Math.max(m, panelLayer(p)), -1) + 1;
}

export function newPanel(canvas: { width: number; height: number }, panels: LayoutPanel[]): LayoutPanel {
  // Sized as a fraction of the canvas (rather than a fixed pixel size) so a
  // new panel looks reasonably proportioned whatever the canvas dimensions are.
  const width = Math.round(Math.min(Math.max(canvas.width * 0.2, 120), 400));
  const height = Math.round(Math.min(Math.max(canvas.height * 0.2, 80), 300));
  return {
    id: crypto.randomUUID(),
    label: 'New panel',
    x: Math.max(0, Math.round(canvas.width / 2 - width / 2)),
    y: Math.max(0, Math.round(canvas.height / 2 - height / 2)),
    width,
    height,
    bindings: [],
    layer: topLayer(panels),
  };
}

// Stacking-order operations (Bring to Front / Send to Back / step one at a
// time), all expressed as pure array transforms so the context-menu actions
// in the editor are simple one-line calls.
export function bringPanelToFront(panels: LayoutPanel[], id: string): LayoutPanel[] {
  const layer = topLayer(panels);
  return panels.map(p => (p.id === id ? { ...p, layer } : p));
}

export function sendPanelToBack(panels: LayoutPanel[], id: string): LayoutPanel[] {
  const layer = panels.reduce((m, p) => Math.min(m, panelLayer(p)), 0) - 1;
  return panels.map(p => (p.id === id ? { ...p, layer } : p));
}

// Swaps the panel's layer with its nearest neighbor in the given direction
// (the panel immediately above it, or immediately below), i.e. "step one at
// a time" rather than jumping straight to front/back.
export function stepPanelLayer(panels: LayoutPanel[], id: string, direction: 1 | -1): LayoutPanel[] {
  const current = panels.find(p => p.id === id);
  if (!current) { return panels; }
  const currentLayer = panelLayer(current);

  let neighbor: LayoutPanel | null = null;
  for (const p of panels) {
    if (p.id === id) { continue; }
    const l = panelLayer(p);
    const isCandidate = direction === 1 ? l > currentLayer : l < currentLayer;
    if (!isCandidate) { continue; }
    if (!neighbor || (direction === 1 ? l < panelLayer(neighbor) : l > panelLayer(neighbor))) {
      neighbor = p;
    }
  }
  if (!neighbor) { return panels; }

  const neighborLayer = panelLayer(neighbor);
  const neighborId = neighbor.id;
  return panels.map(p => {
    if (p.id === id) { return { ...p, layer: neighborLayer }; }
    if (p.id === neighborId) { return { ...p, layer: currentLayer }; }
    return p;
  });
}

export function focusEntryLabel(binding: FocusEntry): string {
  return binding.source === 'interface'
    ? `${binding.kind} · ${binding.pkg}/${binding.name || '?'}`
    : `${binding.kind} · ${binding.name || '?'}`;
}

export function bindingsSummary(bindings: FocusEntry[]): string {
  return bindings.length === 0 ? 'No binding' : bindings.map(focusEntryLabel).join(', ');
}
