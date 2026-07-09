import { useEffect, useRef, useState } from 'react';
import { ros2Api } from '../../ros2_apis/ros2Api';
import type { ChannelKind, GraphChannel, InterfaceListResult } from '../../ros2_apis/bridge_types';
import SearchableSelect from '../layout-editor/SearchableSelect';

// topic/service/action carry a real ROS2 interface *type* string, resolvable
// from the installed interface list. control/hardware_interface don't — their
// "type" is a free-form interface name (e.g. "position", "velocity/effort"), so
// they get a plain text field instead of the interface combobox.
const KIND_SUBDIR: Partial<Record<ChannelKind, string>> = { topic: 'msg', service: 'srv', action: 'action' };

function typeOptionsFor(list: InterfaceListResult | null, kind: ChannelKind): string[] {
  if (!list) { return []; }
  if (kind === 'topic')   { return list.msgs.map(e => `${e.pkg}/msg/${e.name}`); }
  if (kind === 'service') { return list.srvs.map(e => `${e.pkg}/srv/${e.name}`); }
  if (kind === 'action')  { return list.actions.map(e => `${e.pkg}/action/${e.name}`); }
  return [];
}

// Double-click editor for a channel ellipse. For ROS2 interface kinds the type
// picker is the same SearchableSelect combobox the layout editor's binding row
// uses; for ros2_control kinds it's a free-text interface name.
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

  const isRosInterface = channel.kind in KIND_SUBDIR;

  // Include the currently-set type even if it isn't among the installed
  // interfaces (e.g. a graph authored against a different workspace), so the
  // combobox still shows it as selected rather than appearing empty.
  const installed = typeOptionsFor(interfaces, channel.kind);
  const typeOptions = channel.type && !installed.includes(channel.type)
    ? [channel.type, ...installed]
    : installed;

  return (
    <div
      className="layout-modal-backdrop"
      onMouseDown={e => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedOnBackdrop.current && e.target === e.currentTarget) { onClose(); } }}
    >
      <div className="layout-modal" onClick={e => e.stopPropagation()}>
        <div className="layout-modal-header">
          <span>Edit channel</span>
          <button className="layout-modal-close" onClick={onClose}>×</button>
        </div>

        <label className="layout-field">
          Kind
          <select value={channel.kind} onChange={e => onChange({ kind: e.target.value as ChannelKind })}>
            <option value="topic">Topic</option>
            <option value="service">Service</option>
            <option value="action">Action</option>
            <option value="control">Control interface</option>
            <option value="hardware_interface">Hardware interface</option>
          </select>
        </label>

        <label className="layout-field">
          Name
          <input
            value={channel.name}
            onChange={e => onChange({ name: e.target.value })}
            placeholder={channel.kind === 'topic' ? '/cmd_vel' : channel.kind === 'control' ? 'position' : '/add_two_ints'}
          />
        </label>

        {isRosInterface ? (
          <div className="layout-field">
            Type
            <SearchableSelect
              value={channel.type}
              placeholder={`Search ${channel.kind === 'topic' ? 'messages' : channel.kind === 'service' ? 'services' : 'actions'}…`}
              options={typeOptions.map(t => ({ value: t, label: t }))}
              onChange={type => onChange({ type })}
            />
          </div>
        ) : (
          <label className="layout-field">
            Interface type
            <input
              value={channel.type}
              onChange={e => onChange({ type: e.target.value })}
              placeholder={channel.kind === 'control' ? 'e.g. position, velocity, effort' : 'e.g. hardware_interface/SystemInterface'}
            />
          </label>
        )}

        <div className="layout-modal-actions">
          <button className="layout-delete-btn" onClick={onDelete}>Delete channel</button>
          <button className="layout-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
