import { useCallback, useEffect, useRef, useState } from 'react';
import { layoutApi } from '../../ros2_apis/layoutApi';
import type { LayoutDocument, LayoutPanel } from '../../ros2_apis/bridge_types';
import { PlusIcon } from '../icons';
import {
  CANVAS_PAD, DEFAULT_GRID_SIZE, DRAG_THRESHOLD_PX, HANDLES, SNAP_THRESHOLD_SCREEN_PX, ZOOM_STEP,
  bindingsSummary, bringPanelToFront, clampZoom, collectSnapCandidates, newPanel, panelLayer,
  sendPanelToBack, snapAxis, snapToGrid, stepPanelLayer, topLayer,
  type DragMode, type SnapLine,
} from './layoutModel';
import LayoutConfigPanel from './LayoutConfigPanel';
import PanelEditor from './PanelEditor';
import '../InterfaceBrowser.css';
import '../LayoutEditor.css';

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

  // Context-menu stacking actions, all one-line calls into layoutModel.ts.
  function applyPanelTransform(transform: (panels: LayoutPanel[]) => LayoutPanel[]) {
    if (!doc) { return; }
    commit({ ...doc, panels: transform(doc.panels) });
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
          <button onClick={() => applyPanelTransform(panels => bringPanelToFront(panels, menu.id))}>Bring to front</button>
          <button onClick={() => applyPanelTransform(panels => stepPanelLayer(panels, menu.id, 1))}>Bring forward</button>
          <button onClick={() => applyPanelTransform(panels => stepPanelLayer(panels, menu.id, -1))}>Send backward</button>
          <button onClick={() => applyPanelTransform(panels => sendPanelToBack(panels, menu.id))}>Send to back</button>
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
