import { useRef } from 'react';
import type { GraphNode, NodeKind, NodeLanguage } from '../../ros2_apis/bridge_types';

// Double-click editor for a node rectangle. Reuses the layout editor's modal /
// field CSS classes (globally bundled) for a consistent look.
export default function NodeDetailModal({ node, onChange, onClose, onDelete }: {
  node: GraphNode;
  onChange: (changes: Partial<GraphNode>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  // Only treat a backdrop click as "close" when both press and release land on
  // it (so a text selection that drifts onto the backdrop doesn't close) — same
  // reasoning as the layout PanelEditor.
  const pressedOnBackdrop = useRef(false);

  // ros2_control controllers and hardware are C++ plugins, so their language is
  // fixed to cpp — switching a node to one of those kinds coerces it.
  const cppOnly = node.kind !== 'node';

  function changeKind(kind: NodeKind) {
    onChange(kind === 'node' ? { kind } : { kind, language: 'cpp' });
  }

  return (
    <div
      className="layout-modal-backdrop"
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedOnBackdrop.current && e.target === e.currentTarget) { onClose(); } }}
    >
      <div className="layout-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-modal-header">
          <span>Edit {node.kind}</span>
          <button className="layout-modal-close" onClick={onClose}>×</button>
        </div>

        <label className="layout-field">
          Kind
          <select value={node.kind} onChange={e => changeKind(e.target.value as NodeKind)}>
            <option value="node">Node</option>
            <option value="controller">Controller</option>
            <option value="hardware">Hardware</option>
          </select>
        </label>

        <label className="layout-field">
          Name
          <input value={node.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. motion_planner" />
        </label>

        <label className="layout-field">
          Namespace
          <input value={node.namespace} onChange={e => onChange({ namespace: e.target.value })} placeholder="/" />
        </label>

        <label className="layout-field">
          Language
          <select
            value={node.language}
            disabled={cppOnly}
            title={cppOnly ? 'ros2_control controllers and hardware are C++' : undefined}
            onChange={e => onChange({ language: e.target.value as NodeLanguage })}
          >
            <option value="cpp">C++</option>
            <option value="py">Python</option>
          </select>
        </label>

        <label className="layout-field">
          Notes
          <textarea
            value={node.notes ?? ''}
            placeholder="What is this node responsible for? (fed to the AI when scaffolding it)"
            onChange={e => onChange({ notes: e.target.value })}
          />
        </label>

        <div className="layout-modal-actions">
          <button className="layout-delete-btn" onClick={onDelete}>Delete node</button>
          <button className="layout-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
