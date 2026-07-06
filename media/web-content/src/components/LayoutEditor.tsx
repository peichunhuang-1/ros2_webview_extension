import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ros2Api } from '../ros2_apis/ros2Api';
import { layoutApi } from '../ros2_apis/layoutApi';
import type {
  FocusEntry, GraphKind, GraphListResult, InterfaceKind, InterfaceListResult, LayoutDocument, LayoutPanel,
} from '../ros2_apis/bridge_types';
import { PlusIcon, TrashIcon } from './icons';
import './InterfaceBrowser.css';
import './LayoutEditor.css';

const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type Handle = typeof HANDLES[number];
type DragMode = 'move' | Handle;

const DEFAULT_GRID_SIZE = 40;
const MIN_CANVAS_SIZE = 200;
const MIN_GRID_SIZE = 4;
// Screen-space distance a pointer must travel before a press counts as a
// drag rather than a click — without this, the tiny jitter between the two
// clicks of a double-click nudges the panel and the edit modal never opens.
const DRAG_THRESHOLD_PX = 4;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const CANVAS_PAD = 24;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// Screen-space distance within which a dragged/resized edge snaps to a
// guide (canvas center or another panel's edge/center). Converted to
// canvas-space by dividing by the current display scale, so the snap feels
// like a constant distance under the pointer regardless of zoom level.
const SNAP_THRESHOLD_SCREEN_PX = 6;

type SnapLine = { axis: 'x' | 'y'; pos: number };

// Vertical guides are candidate x-positions (canvas center + other panels'
// left/center/right edges); horizontal guides are the y equivalent.
function collectSnapCandidates(doc: LayoutDocument, excludeId: string): { x: number[]; y: number[] } {
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
function snapAxis(edges: number[], candidates: number[], threshold: number): { delta: number; lines: number[] } {
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

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function panelLayer(p: LayoutPanel): number {
  return p.layer ?? 0;
}

function topLayer(panels: LayoutPanel[]): number {
  return panels.reduce((m, p) => Math.max(m, panelLayer(p)), -1) + 1;
}

// Quick-start templates for the Notes field: writing a good freeform description of "what
// should this panel do" for every single panel was reported as the most tedious part of
// building a layout. Picking one of these fills Notes with a solid default in one click; the
// user (or Claude) can still edit the result, but for most panels this replaces typing a
// paragraph with a single click.
interface PanelTypePreset { key: string; label: string; notes: string }

// A binding can be either { source: 'graph', name, ... } (a live topic/service/action with a
// real name already) or { source: 'interface', pkg, name, ... } (just a message/service/action
// *type* — no live name, and no guarantee it's used as a topic vs. a service/action call — a
// chart could just as well be fed by repeated service calls, a button could publish to a topic
// instead of calling a service, etc.). Append this reminder regardless of preset so the
// generated panel doesn't just hard-code a made-up name when there isn't a real one yet.
const INTERFACE_BINDING_NOTE = "If a binding is an interface (a type only, no live name yet), add a text input or select so the user can specify which topic/service/action to use.";

const PANEL_TYPE_PRESETS: PanelTypePreset[] = [
  { key: 'chart', label: 'Chart', notes: `Live line chart of this topic's numeric field(s) over time (~30s rolling window), Y axis auto-scaled, current value shown in the corner. ${INTERFACE_BINDING_NOTE}` },
  { key: 'table', label: 'Table', notes: `Table of the latest message's fields as rows (name | value), updating live as new messages arrive. ${INTERFACE_BINDING_NOTE}` },
  { key: 'image', label: 'Image/video', notes: `Live image viewer for this topic's image data, fit to the panel, no controls. ${INTERFACE_BINDING_NOTE}` },
  { key: 'status', label: 'Status badge', notes: `Compact status indicator: colored dot + short text for the latest value/state. Green = nominal, red = problem, gray = no data yet. ${INTERFACE_BINDING_NOTE}` },
  { key: 'button', label: 'Button/trigger', notes: `Button(s) that call this service/action on click, showing a brief pending/success/error state after each click. ${INTERFACE_BINDING_NOTE}` },
  { key: 'slider', label: 'Slider/control', notes: `Slider (or number input) to set a numeric value and publish/call it, with the current value shown next to the control. ${INTERFACE_BINDING_NOTE}` },
];

function newPanel(canvas: { width: number; height: number }, panels: LayoutPanel[]): LayoutPanel {
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
// below are simple one-line calls.
function bringPanelToFront(panels: LayoutPanel[], id: string): LayoutPanel[] {
  const layer = topLayer(panels);
  return panels.map(p => (p.id === id ? { ...p, layer } : p));
}

function sendPanelToBack(panels: LayoutPanel[], id: string): LayoutPanel[] {
  const layer = panels.reduce((m, p) => Math.min(m, panelLayer(p)), 0) - 1;
  return panels.map(p => (p.id === id ? { ...p, layer } : p));
}

// Swaps the panel's layer with its nearest neighbor in the given direction
// (the panel immediately above it, or immediately below), i.e. "step one at
// a time" rather than jumping straight to front/back.
function stepPanelLayer(panels: LayoutPanel[], id: string, direction: 1 | -1): LayoutPanel[] {
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

function focusEntryLabel(binding: FocusEntry): string {
  return binding.source === 'interface'
    ? `${binding.kind} · ${binding.pkg}/${binding.name || '?'}`
    : `${binding.kind} · ${binding.name || '?'}`;
}

function bindingsSummary(bindings: FocusEntry[]): string {
  return bindings.length === 0 ? 'No binding' : bindings.map(focusEntryLabel).join(', ');
}

export default function LayoutEditor() {
  const [doc, setDoc] = useState<LayoutDocument | null>(null);
  const [imageUris, setImageUris] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tab, setTab] = useState<'canvas' | 'config'>('canvas');
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  // A callback ref (not a plain useRef) so the effects below re-run exactly
  // when the canvas DOM node actually mounts. It only exists once `doc` has
  // loaded and the Canvas tab is showing — either of which can change
  // without `tab` itself changing, so an effect keyed on `[tab]` alone could
  // run once while this was still null and never fire again.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapLine[]>([]);
  const dragState = useRef<{ id: string; mode: DragMode; startX: number; startY: number; orig: LayoutPanel; moved: boolean } | null>(null);

  // Scales the canvas to fill the visible editor area so the on-screen
  // proportions of a panel to the whole canvas match its stored ratio,
  // regardless of how large the canvas or the editor pane is. `zoom` is a
  // user-controlled multiplier on top of that fit scale.
  //
  // Measures the border box (via getBoundingClientRect, not contentRect) so
  // this stays stable even though we adjust this element's own padding below
  // — contentRect would shrink/grow as padding changes, causing feedback.
  useEffect(() => {
    const el = scrollEl;
    if (!el) { return; }
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollEl]);

  // React attaches onWheel as a passive listener, so preventDefault() there
  // can't stop the browser's own pinch/ctrl-scroll zoom — a native listener
  // is required to actually intercept it.
  useEffect(() => {
    const el = scrollEl;
    if (!el) { return; }
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) { return; }
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom(z => clampZoom(z * factor));
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [scrollEl]);

  useEffect(() => {
    const unsubscribe = layoutApi.onInit(payload => {
      setDoc(payload.doc);
      setImageUris(payload.imageUris);
    });
    layoutApi.ready();
    return unsubscribe;
  }, []);

  const commit = useCallback((next: LayoutDocument) => {
    setDoc(next);
    layoutApi.update(next);
  }, []);

  function updatePanel(id: string, changes: Partial<LayoutPanel>) {
    if (!doc) { return; }
    commit({ ...doc, panels: doc.panels.map(p => (p.id === id ? { ...p, ...changes } : p)) });
  }

  function addPanel() {
    if (!doc) { return; }
    commit({ ...doc, panels: [...doc.panels, newPanel(doc.canvas, doc.panels)] });
  }

  function duplicatePanel(id: string) {
    if (!doc) { return; }
    const source = doc.panels.find(p => p.id === id);
    if (!source) { return; }
    const copy: LayoutPanel = {
      ...source,
      id: crypto.randomUUID(),
      x: source.x + 20,
      y: source.y + 20,
      label: `${source.label} copy`,
      layer: topLayer(doc.panels),
      bindings: [...source.bindings],
    };
    commit({ ...doc, panels: [...doc.panels, copy] });
    setMenu(null);
  }

  function deletePanel(id: string) {
    if (!doc) { return; }
    commit({ ...doc, panels: doc.panels.filter(p => p.id !== id) });
    setMenu(null);
    setEditingId(current => (current === id ? null : current));
  }

  function bringToFront(id: string) {
    if (!doc) { return; }
    commit({ ...doc, panels: bringPanelToFront(doc.panels, id) });
    setMenu(null);
  }

  function sendToBack(id: string) {
    if (!doc) { return; }
    commit({ ...doc, panels: sendPanelToBack(doc.panels, id) });
    setMenu(null);
  }

  function bringForward(id: string) {
    if (!doc) { return; }
    commit({ ...doc, panels: stepPanelLayer(doc.panels, id, 1) });
    setMenu(null);
  }

  function sendBackward(id: string) {
    if (!doc) { return; }
    commit({ ...doc, panels: stepPanelLayer(doc.panels, id, -1) });
    setMenu(null);
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>, panel: LayoutPanel, mode: DragMode) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { id: panel.id, mode, startX: e.clientX, startY: e.clientY, orig: panel, moved: false };
  }

  function onDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || !doc) { return; }

    if (!drag.moved) {
      const screenDist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (screenDist < DRAG_THRESHOLD_PX) { return; }
      drag.moved = true;
    }

    // Pointer coordinates are in screen space, but the canvas is rendered
    // scaled — convert back to canvas-space deltas before applying.
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    const { orig, mode } = drag;

    const west = mode !== 'move' && mode.includes('w');
    const north = mode !== 'move' && mode.includes('n');

    let next = { x: orig.x, y: orig.y, width: orig.width, height: orig.height };
    if (mode === 'move') {
      const maxX = Math.max(0, doc.canvas.width - orig.width);
      const maxY = Math.max(0, doc.canvas.height - orig.height);
      next = { ...next, x: Math.min(maxX, Math.max(0, orig.x + dx)), y: Math.min(maxY, Math.max(0, orig.y + dy)) };
    } else {
      if (west) {
        const rightEdge = orig.x + orig.width;
        next.x = Math.max(0, Math.min(orig.x + dx, rightEdge - 40));
        next.width = rightEdge - next.x;
      } else {
        next.width = Math.max(40, Math.min(orig.width + dx, doc.canvas.width - orig.x));
      }
      if (north) {
        const bottomEdge = orig.y + orig.height;
        next.y = Math.max(0, Math.min(orig.y + dy, bottomEdge - 30));
        next.height = bottomEdge - next.y;
      } else {
        next.height = Math.max(30, Math.min(orig.height + dy, doc.canvas.height - orig.y));
      }
    }

    // Precision comes from two layers, applied per-axis: a smart guide
    // (canvas center / a nearby panel's edge or center) wins when close
    // enough to engage, otherwise the edge snaps to the grid — so dragging
    // and resizing always lands on a grid-aligned value unless a guide
    // pulls it onto something more specific. Hold Alt to bypass both and
    // move/resize freely.
    if (e.altKey) {
      setSnapGuides([]);
    } else {
      const threshold = SNAP_THRESHOLD_SCREEN_PX / scale;
      const { x: candX, y: candY } = collectSnapCandidates(doc, drag.id);
      const guides: SnapLine[] = [];

      if (mode === 'move') {
        const edgesX = [next.x, next.x + next.width / 2, next.x + next.width];
        const edgesY = [next.y, next.y + next.height / 2, next.y + next.height];
        const snapX = snapAxis(edgesX, candX, threshold);
        const snapY = snapAxis(edgesY, candY, threshold);
        const maxX = Math.max(0, doc.canvas.width - next.width);
        const maxY = Math.max(0, doc.canvas.height - next.height);
        const targetX = snapX.lines.length ? next.x + snapX.delta : snapToGrid(next.x, gridSize);
        const targetY = snapY.lines.length ? next.y + snapY.delta : snapToGrid(next.y, gridSize);
        next.x = Math.min(maxX, Math.max(0, targetX));
        next.y = Math.min(maxY, Math.max(0, targetY));
        guides.push(...snapX.lines.map(pos => ({ axis: 'x' as const, pos })));
        guides.push(...snapY.lines.map(pos => ({ axis: 'y' as const, pos })));
      } else {
        const freeEdgeX = west ? next.x : next.x + next.width;
        const freeEdgeY = north ? next.y : next.y + next.height;
        const snapX = snapAxis([freeEdgeX], candX, threshold);
        const snapY = snapAxis([freeEdgeY], candY, threshold);
        const targetEdgeX = snapX.lines.length ? freeEdgeX + snapX.delta : snapToGrid(freeEdgeX, gridSize);
        const targetEdgeY = snapY.lines.length ? freeEdgeY + snapY.delta : snapToGrid(freeEdgeY, gridSize);
        if (west) {
          const rightEdge = next.x + next.width;
          next.x = Math.max(0, Math.min(targetEdgeX, rightEdge - 40));
          next.width = rightEdge - next.x;
        } else {
          next.width = Math.max(40, Math.min(targetEdgeX - next.x, doc.canvas.width - next.x));
        }
        if (north) {
          const bottomEdge = next.y + next.height;
          next.y = Math.max(0, Math.min(targetEdgeY, bottomEdge - 30));
          next.height = bottomEdge - next.y;
        } else {
          next.height = Math.max(30, Math.min(targetEdgeY - next.y, doc.canvas.height - next.y));
        }
        guides.push(...snapX.lines.map(pos => ({ axis: 'x' as const, pos })));
        guides.push(...snapY.lines.map(pos => ({ axis: 'y' as const, pos })));
      }

      setSnapGuides(guides);
    }

    setDoc({ ...doc, panels: doc.panels.map(p => (p.id === drag.id ? { ...p, ...next } : p)) });
  }

  function onDragEnd() {
    if (dragState.current?.moved && doc) {
      layoutApi.update(doc);
    }
    dragState.current = null;
    setSnapGuides([]);
  }

  const editing = doc?.panels.find(p => p.id === editingId) ?? null;

  if (!doc) {
    return <div className="layout-editor"><p className="hint">Loading layout…</p></div>;
  }

  const gridSize = doc.canvas.gridSize || DEFAULT_GRID_SIZE;
  // Fit-contain: the canvas is scaled (not cropped) to fill the available
  // pane, so the on-screen ratio of a panel to the whole canvas always
  // matches its stored ratio — independent of the editor pane's real size.
  // `zoom` then lets the user scale further in/out from that baseline.
  const availWidth = Math.max(0, viewport.width - CANVAS_PAD * 2);
  const availHeight = Math.max(0, viewport.height - CANVAS_PAD * 2);
  const fitScale = availWidth > 0 && availHeight > 0
    ? Math.min(availWidth / doc.canvas.width, availHeight / doc.canvas.height)
    : 1;
  const scale = fitScale * zoom;
  const stageWidth = doc.canvas.width * scale;
  const stageHeight = doc.canvas.height * scale;
  // Padding (not flex centering) so the canvas is still centered when it
  // fits, but never becomes partly unreachable by scrolling once zoomed
  // past the viewport — centering via flex/margin would need negative
  // scroll offsets to reach the overflowing start edge, which scrolling
  // can't do.
  const padX = Math.max(CANVAS_PAD, (viewport.width - stageWidth) / 2);
  const padY = Math.max(CANVAS_PAD, (viewport.height - stageHeight) / 2);

  return (
    <div className="layout-editor" onClick={() => setMenu(null)}>
      <header className="layout-toolbar">
        <div className="layout-toolbar-left">
          <span className="title">Layout Editor</span>
          <div className="layout-tabs">
            <button className={`layout-tab${tab === 'canvas' ? ' active' : ''}`} onClick={() => setTab('canvas')}>Canvas</button>
            <button className={`layout-tab${tab === 'config' ? ' active' : ''}`} onClick={() => setTab('config')}>Config</button>
          </div>
        </div>
        {tab === 'canvas' && (
          <div className="layout-toolbar-right">
            <div className="layout-zoom-controls">
              <button className="layout-zoom-btn" onClick={() => setZoom(z => clampZoom(z / ZOOM_STEP))} title="Zoom out">−</button>
              <button className="layout-zoom-pct" onClick={() => setZoom(1)} title="Reset zoom to fit">{Math.round(scale * 100)}%</button>
              <button className="layout-zoom-btn" onClick={() => setZoom(z => clampZoom(z * ZOOM_STEP))} title="Zoom in">+</button>
            </div>
            <button className="layout-add-btn" onClick={addPanel}><PlusIcon /> Add panel</button>
          </div>
        )}
      </header>

      {tab === 'config' ? (
        <LayoutConfigPanel
          canvas={doc.canvas}
          onChange={changes => commit({ ...doc, canvas: { ...doc.canvas, ...changes } })}
        />
      ) : (
        <div className="layout-canvas-scroll" ref={setScrollEl} style={{ padding: `${padY}px ${padX}px` }}>
          <div className="layout-canvas-stage" style={{ width: stageWidth, height: stageHeight }}>
            <div
              className="layout-canvas"
              style={{
                width: doc.canvas.width,
                height: doc.canvas.height,
                transform: `scale(${scale})`,
                ['--grid-size' as string]: `${gridSize}px`,
              } as React.CSSProperties}
            >
              {doc.panels.map(panel => (
                <div
                  key={panel.id}
                  className="layout-panel"
                  style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: panelLayer(panel) }}
                  onPointerDown={e => startDrag(e, panel, 'move')}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(panel.id); }}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ id: panel.id, x: e.clientX, y: e.clientY }); }}
                >
                  {panel.image && imageUris[panel.image] && (
                    <img className="layout-panel-image" src={imageUris[panel.image]} alt="" />
                  )}
                  <div className="layout-panel-label">{panel.label}</div>
                  <div className="layout-panel-binding">{bindingsSummary(panel.bindings)}</div>

                  {HANDLES.map(handle => (
                    <div
                      key={handle}
                      className={`layout-handle layout-handle-${handle}`}
                      onPointerDown={e => startDrag(e, panel, handle)}
                      onPointerMove={onDragMove}
                      onPointerUp={onDragEnd}
                    />
                  ))}
                </div>
              ))}

              {snapGuides.map((line, i) => (
                <div
                  key={`${line.axis}-${i}`}
                  className={line.axis === 'x' ? 'layout-guide layout-guide-v' : 'layout-guide layout-guide-h'}
                  style={line.axis === 'x' ? { left: line.pos } : { top: line.pos }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {menu && (
        <div className="layout-context-menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { setEditingId(menu.id); setMenu(null); }}>Edit…</button>
          <button onClick={() => duplicatePanel(menu.id)}>Duplicate</button>
          <div className="layout-context-menu-divider" />
          <button onClick={() => bringToFront(menu.id)}>Bring to front</button>
          <button onClick={() => bringForward(menu.id)}>Bring forward</button>
          <button onClick={() => sendBackward(menu.id)}>Send backward</button>
          <button onClick={() => sendToBack(menu.id)}>Send to back</button>
          <div className="layout-context-menu-divider" />
          <button onClick={() => deletePanel(menu.id)}>Delete</button>
        </div>
      )}

      {editing && (
        <PanelEditor
          panel={editing}
          onChange={changes => updatePanel(editing.id, changes)}
          onClose={() => setEditingId(null)}
          onDelete={() => deletePanel(editing.id)}
        />
      )}
    </div>
  );
}

function LayoutConfigPanel({ canvas, onChange }: {
  canvas: LayoutDocument['canvas'];
  onChange: (changes: Partial<LayoutDocument['canvas']>) => void;
}) {
  return (
    <div className="layout-config">
      <p className="hint">
        These settings control the canvas every panel is positioned on. Changing the canvas size
        rescales what you see here to fit the editor, but panel pixel coordinates are unaffected —
        resize the canvas to match your target screen so panel ratios line up correctly.
      </p>

      <NumberField
        label="Canvas width (px)"
        value={canvas.width}
        min={MIN_CANVAS_SIZE}
        onCommit={width => onChange({ width })}
      />
      <NumberField
        label="Canvas height (px)"
        value={canvas.height}
        min={MIN_CANVAS_SIZE}
        onCommit={height => onChange({ height })}
      />
      <NumberField
        label="Grid size (px)"
        value={canvas.gridSize || DEFAULT_GRID_SIZE}
        min={MIN_GRID_SIZE}
        onCommit={gridSize => onChange({ gridSize })}
      />
    </div>
  );
}

// A plain controlled <input type="number"> that clamps on every keystroke
// makes it impossible to type e.g. "10" when the minimum is 4 — the leading
// "1" gets clamped up to "4" before you can type the second digit. So typing
// is tracked as free-form local text, and the min/rounding is only enforced
// once you commit (blur or Enter).
function NumberField({ label, value, min, onCommit }: {
  label: string;
  value: number;
  min: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) { setText(String(value)); }
  }, [value]);

  function commit() {
    const parsed = Math.round(Number(text));
    const next = Number.isFinite(parsed) ? Math.max(min, parsed) : value;
    setText(String(next));
    if (next !== value) { onCommit(next); }
  }

  return (
    <label className="layout-field">
      {label}
      <input
        ref={inputRef}
        type="number"
        min={min}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
      />
    </label>
  );
}

function PanelEditor({ panel, onChange, onClose, onDelete }: {
  panel: LayoutPanel;
  onChange: (changes: Partial<LayoutPanel>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [interfaces, setInterfaces] = useState<InterfaceListResult | null>(null);
  const [graph, setGraph] = useState<GraphListResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Presets aren't persisted on the panel (only their effect on `notes` is), so this is just
  // local UI state to keep the select showing what was last picked instead of snapping back to
  // the placeholder — resets when the panel editor is reopened, which is fine since it's only a
  // quick-start shortcut, not a stored "panel type".
  const [selectedPresetKey, setSelectedPresetKey] = useState('');

  useEffect(() => {
    ros2Api.listInterfaces().then(setInterfaces).catch(() => {});
    ros2Api.listGraph().then(setGraph).catch(() => {});
  }, []);

  function addBinding() {
    onChange({ bindings: [...panel.bindings, { source: 'interface', kind: 'msg', pkg: '', name: '' }] });
  }
  function updateBinding(index: number, next: FocusEntry) {
    onChange({ bindings: panel.bindings.map((b, i) => (i === index ? next : b)) });
  }
  function removeBinding(index: number) {
    onChange({ bindings: panel.bindings.filter((_, i) => i !== index) });
  }

  async function handleImageFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const result = await layoutApi.uploadImage(dataUri, file.name);
      onChange({ image: result.relativePath });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  // A click event's target is resolved to the nearest common ancestor of
  // its mousedown and mouseup targets — so selecting text starting inside
  // the modal (e.g. dragging across the Label input) and releasing the
  // mouse after it drifts outside the modal box fires a "click" targeting
  // this backdrop, closing it. Only treat it as a real backdrop click when
  // *both* the press and release land directly on the backdrop itself.
  const pressedOnBackdrop = useRef(false);

  return (
    <div
      className="layout-modal-backdrop"
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedOnBackdrop.current && e.target === e.currentTarget) { onClose(); } }}
    >
      <div className="layout-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-modal-header">
          <span>Edit panel</span>
          <button className="layout-modal-close" onClick={onClose}>×</button>
        </div>

        <label className="layout-field">
          Label
          <input value={panel.label} onChange={e => onChange({ label: e.target.value })} />
        </label>

        <NumberField
          label="Layer (higher draws on top of overlapping panels)"
          value={panelLayer(panel)}
          min={-999999}
          onCommit={layer => onChange({ layer })}
        />

        <label className="layout-field">
          Notes
          <select
            className="layout-panel-type-select"
            value={selectedPresetKey}
            onChange={e => {
              const preset = PANEL_TYPE_PRESETS.find(p => p.key === e.target.value);
              if (preset) { onChange({ notes: preset.notes }); setSelectedPresetKey(preset.key); }
            }}
          >
            <option value="" disabled>Quick start: choose a panel type…</option>
            {PANEL_TYPE_PRESETS.map(preset => (
              <option key={preset.key} value={preset.key} title={preset.notes}>{preset.label}</option>
            ))}
          </select>
          <textarea
            value={panel.notes ?? ''}
            placeholder="Pick a starting point above, or describe what this panel should look like / do…"
            onChange={e => onChange({ notes: e.target.value })}
          />
        </label>

        <div className="layout-field">
          Bindings
          <div className="layout-bindings-list">
            {panel.bindings.map((binding, i) => (
              <BindingRow
                key={i}
                binding={binding}
                interfaces={interfaces}
                graph={graph}
                onChange={next => updateBinding(i, next)}
                onRemove={() => removeBinding(i)}
              />
            ))}
            {panel.bindings.length === 0 && <p className="hint">No bindings yet.</p>}
          </div>
          <button type="button" className="layout-add-binding-btn" onClick={addBinding}><PlusIcon /> Add binding</button>
        </div>

        <div className="layout-field">
          Reference image
          <div className="layout-image-row">
            {panel.image && <span className="layout-image-name">{panel.image}</span>}
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={e => { const file = e.target.files?.[0]; if (file) { void handleImageFile(file); } e.target.value = ''; }}
            />
            {panel.image && (
              <button className="layout-image-remove" onClick={() => onChange({ image: undefined })} title="Remove image">
                <TrashIcon />
              </button>
            )}
          </div>
          {uploading && <p className="hint">Uploading…</p>}
          {uploadError && <p className="hint interface-error">{uploadError}</p>}
        </div>

        <div className="layout-modal-actions">
          <button className="layout-delete-btn" onClick={onDelete}>Delete panel</button>
          <button className="layout-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function BindingRow({ binding, interfaces, graph, onChange, onRemove }: {
  binding: FocusEntry;
  interfaces: InterfaceListResult | null;
  graph: GraphListResult | null;
  onChange: (next: FocusEntry) => void;
  onRemove: () => void;
}) {
  function setSource(source: 'interface' | 'graph') {
    onChange(source === 'interface'
      ? { source: 'interface', kind: 'msg', pkg: '', name: '' }
      : { source: 'graph', kind: 'topic', name: '', types: [] });
  }
  function setInterfaceKind(kind: InterfaceKind) {
    onChange({ source: 'interface', kind, pkg: '', name: '' });
  }
  function setGraphKind(kind: GraphKind) {
    onChange({ source: 'graph', kind, name: '', types: [] });
  }

  const interfaceEntries = interfaces && binding.source === 'interface'
    ? (binding.kind === 'msg' ? interfaces.msgs : binding.kind === 'srv' ? interfaces.srvs : interfaces.actions)
    : [];
  const graphEntries = graph && binding.source === 'graph'
    ? (binding.kind === 'topic' ? graph.topics : binding.kind === 'service' ? graph.services : graph.actions)
    : [];

  return (
    <div className="layout-binding-row">
      <select value={binding.source} onChange={e => setSource(e.target.value as 'interface' | 'graph')}>
        <option value="interface">Interface definition</option>
        <option value="graph">Live graph entry</option>
      </select>

      {binding.source === 'interface' ? (
        <>
          <select value={binding.kind} onChange={e => setInterfaceKind(e.target.value as InterfaceKind)}>
            <option value="msg">msg</option>
            <option value="srv">srv</option>
            <option value="action">action</option>
          </select>
          <SearchableSelect
            value={binding.pkg && binding.name ? `${binding.pkg}/${binding.name}` : ''}
            placeholder="Search interfaces…"
            options={interfaceEntries.map(entry => ({ value: `${entry.pkg}/${entry.name}`, label: `${entry.pkg}/${entry.name}` }))}
            onChange={value => {
              const [pkg, name] = value.split('/');
              onChange({ ...binding, pkg, name });
            }}
          />
        </>
      ) : (
        <>
          <select value={binding.kind} onChange={e => setGraphKind(e.target.value as GraphKind)}>
            <option value="topic">topic</option>
            <option value="service">service</option>
            <option value="action">action</option>
          </select>
          <SearchableSelect
            value={binding.name}
            placeholder="Search live graph…"
            options={graphEntries.map(entry => ({ value: entry.name, label: entry.name }))}
            onChange={name => {
              const entry = graphEntries.find(g => g.name === name);
              onChange({ ...binding, name, types: entry?.types ?? [] });
            }}
          />
        </>
      )}

      <button type="button" className="layout-image-remove" onClick={onRemove} title="Remove binding">
        <TrashIcon />
      </button>
    </div>
  );
}

type SelectOption = { value: string; label: string };

// A searchable combobox to replace plain <select> for lists that can get
// long (installed interfaces, live graph topics/services/actions) — typing
// filters the options instead of scrolling a native dropdown.
function SearchableSelect({ value, options, onChange, placeholder }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // The dropdown is portaled to <body> and positioned by these fixed
  // coordinates (from the input's own bounding rect) rather than living
  // inside .layout-searchable-select — the edit modal scrolls, and a plain
  // absolutely-positioned dropdown would get clipped by that scroll box
  // whenever a binding row is near the bottom of a long list.
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function openDropdown() {
    setQuery('');
    setHighlighted(0);
    setOpen(true);
    const r = inputRef.current?.getBoundingClientRect();
    if (r) { setRect({ left: r.left, top: r.bottom + 2, width: r.width }); }
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openDropdown(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[highlighted]; if (opt) { choose(opt); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  return (
    <div className="layout-searchable-select">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={openDropdown}
        onChange={e => { setQuery(e.target.value); setHighlighted(0); setOpen(true); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && rect && createPortal(
        <div className="layout-searchable-dropdown" style={{ left: rect.left, top: rect.top, width: rect.width }}>
          {filtered.length === 0 && <div className="layout-searchable-empty">No matches</div>}
          {filtered.map((option, i) => (
            <div
              key={option.value}
              className={`layout-searchable-option${i === highlighted ? ' highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(option); }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {option.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
