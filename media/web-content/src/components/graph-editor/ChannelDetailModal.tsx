import { useEffect, useRef, useState } from 'react';
import { ros2Api } from '../../ros2_apis/ros2Api';
import type { ChannelKind, GraphChannel, InterfaceListResult } from '../../ros2_apis/bridge_types';

// The interface subdir that appears in a ROS2 type string for each channel kind
// (e.g. "geometry_msgs/msg/Twist", "example_interfaces/srv/AddTwoInts").
const KIND_SUBDIR: Record<ChannelKind, string> = { topic: 'msg', service: 'srv', action: 'action' };

function typeOptionsFor(list: InterfaceListResult | null, kind: ChannelKind): string[] {
  if (!list) { return []; }
  const entries = kind === 'topic' ? list.msgs : kind === 'service' ? list.srvs : list.actions;
  return entries.map(e => `${e.pkg}/${KIND_SUBDIR[kind]}/${e.name}`);
}

// Double-click editor for a channel ellipse. The type field is a free-text
// input backed by a <datalist> of installed interfaces of the matching kind —
// so you get autocomplete against what's installed, but can still type a type
// that isn't installed locally yet.
export default function ChannelDetailModal({ channel, onChange, onClose, onDelete }: {
  channel: GraphChannel;
  onChange: (changes: Partial<GraphChannel>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [interfaces, setInterfaces] = useState<InterfaceListResult | null>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    ros2Api.listInterfaces().then(setInterfaces).catch(() => {});
  }, []);

  const typeOptions = typeOptionsFor(interfaces, channel.kind);

  return (
    <div
      className="layout-modal-backdrop"
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedOnBackdrop.current && e.target === e.currentTarget) { onClose(); } }}
    >
      <div className="layout-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-modal-header">
          <span>Edit {channel.kind}</span>
          <button className="layout-modal-close" onClick={onClose}>×</button>
        </div>

        <label className="layout-field">
          Kind
          <select value={channel.kind} onChange={e => onChange({ kind: e.target.value as ChannelKind })}>
            <option value="topic">Topic</option>
            <option value="service">Service</option>
            <option value="action">Action</option>
          </select>
        </label>

        <label className="layout-field">
          Name
          <input
            value={channel.name}
            onChange={e => onChange({ name: e.target.value })}
            placeholder={channel.kind === 'topic' ? '/cmd_vel' : '/add_two_ints'}
          />
        </label>

        <label className="layout-field">
          Type
          <input
            value={channel.type}
            list="ros2-channel-type-options"
            onChange={e => onChange({ type: e.target.value })}
            placeholder={`${channel.kind === 'topic' ? 'geometry_msgs/msg/Twist' : channel.kind === 'service' ? 'example_interfaces/srv/AddTwoInts' : 'action_tutorials_interfaces/action/Fibonacci'}`}
          />
          <datalist id="ros2-channel-type-options">
            {typeOptions.map(t => <option key={t} value={t} />)}
          </datalist>
        </label>

        <div className="layout-modal-actions">
          <button className="layout-delete-btn" onClick={onDelete}>Delete {channel.kind}</button>
          <button className="layout-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
