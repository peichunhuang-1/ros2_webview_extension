import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphChannel } from '../../ros2_apis/bridge_types';
import { channelKindColor } from './graphModel';

// A topic/service/action, drawn as an ellipse. Same two-handle scheme as the
// node card, so a link's direction (which handle it runs between) encodes
// which ROS role the connected node plays on this channel.
export default function Ros2ChannelNode({ data, selected }: NodeProps) {
  const channel = (data as { channel: GraphChannel }).channel;
  const color = channelKindColor(channel.kind);

  return (
    <div
      className={`ros2-channel-node${selected ? ' selected' : ''}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <span className="ros2-channel-kind" style={{ color }}>{channel.kind}</span>
      <span className="ros2-channel-name">{channel.name || '(unnamed)'}</span>
      <span className="ros2-channel-type">{channel.type || 'no type'}</span>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
