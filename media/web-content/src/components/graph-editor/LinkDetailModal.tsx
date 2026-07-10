import { useRef } from 'react';
import type { GraphChannel, GraphLink, GraphNode, LinkQos } from '../../ros2_apis/bridge_types';
import { channelKindLabel, roleLabel } from './graphModel';

// How a channel reads in the connection summary line.
function channelSummary(channel: GraphChannel): string {
  if (channel.kind === 'interface') {
    return `${channel.joint || '?'}/${channel.name || '?'} (${channel.direction ?? 'command'} interface)`;
  }
  return channel.name || `(unnamed ${channelKindLabel(channel.kind)})`;
}

// Double-click editor for a connection (link). Shows the endpoints it wires,
// per-connection properties (QoS/rate for topics), free-form notes, and a
// delete action — connections were otherwise only removable via the Del key.
export default function LinkDetailModal({ link, node, channel, onChange, onClose, onDelete }: {
  link: GraphLink;
  node: GraphNode;
  channel: GraphChannel;
  onChange: (changes: Partial<GraphLink>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const pressedOnBackdrop = useRef(false);

  const isTopic = channel.kind === 'topic';
  const isPublisher = link.role === 'publisher';

  function updateQos(changes: Partial<LinkQos>) {
    onChange({ qos: { ...link.qos, ...changes } });
  }

  return (
    <div
      className="layout-modal-backdrop"
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedOnBackdrop.current && e.target === e.currentTarget) { onClose(); } }}
    >
      <div className="layout-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-modal-header">
          <span>Edit connection</span>
          <button className="layout-modal-close" onClick={onClose}>×</button>
        </div>

        <p className="hint">
          <strong>{node.name || '(unnamed)'}</strong> {roleLabel(link.role)}{' '}
          <strong>{channelSummary(channel)}</strong>
        </p>

        {isTopic && (
          <>
            <label className="layout-field">
              QoS reliability
              <select
                value={link.qos?.reliability ?? ''}
                onChange={e => updateQos({ reliability: e.target.value ? e.target.value as LinkQos['reliability'] : undefined })}
              >
                <option value="">(default)</option>
                <option value="reliable">Reliable</option>
                <option value="best_effort">Best effort</option>
              </select>
            </label>
            <label className="layout-field">
              QoS durability
              <select
                value={link.qos?.durability ?? ''}
                onChange={e => updateQos({ durability: e.target.value ? e.target.value as LinkQos['durability'] : undefined })}
              >
                <option value="">(default)</option>
                <option value="volatile">Volatile</option>
                <option value="transient_local">Transient local</option>
              </select>
            </label>
            <label className="layout-field">
              QoS depth
              <input
                type="number"
                min={0}
                value={link.qos?.depth ?? ''}
                onChange={e => updateQos({ depth: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                placeholder="e.g. 10"
              />
            </label>
            {isPublisher && (
              <label className="layout-field">
                Publish rate (Hz)
                <input
                  type="number"
                  min={0}
                  value={link.rate ?? ''}
                  onChange={e => onChange({ rate: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                  placeholder="e.g. 30"
                />
              </label>
            )}
          </>
        )}

        <label className="layout-field">
          Notes
          <textarea
            value={link.notes ?? ''}
            placeholder="Anything the implementation of this connection should know…"
            onChange={e => onChange({ notes: e.target.value })}
          />
        </label>

        <div className="layout-modal-actions">
          <button className="layout-delete-btn" onClick={onDelete}>Delete connection</button>
          <button className="layout-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
