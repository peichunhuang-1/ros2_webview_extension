import { useEffect, useRef, useState } from 'react';
import { ros2Api } from '../../ros2_apis/ros2Api';
import { layoutApi } from '../../ros2_apis/layoutApi';
import type { GraphListResult, InterfaceListResult, LayoutPanel } from '../../ros2_apis/bridge_types';
import { PlusIcon, TrashIcon } from '../icons';
import { panelLayer } from './layoutModel';
import { PANEL_TYPE_PRESETS } from './panelPresets';
import NumberField from './NumberField';
import BindingRow from './BindingRow';

// The modal opened by double-clicking a panel (or "Edit…" in its context
// menu): label, layer, notes (with quick-start presets), bindings, and an
// optional reference image.
export default function PanelEditor({ panel, onChange, onClose, onDelete }: {
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
  function updateBinding(index: number, next: LayoutPanel['bindings'][number]) {
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
