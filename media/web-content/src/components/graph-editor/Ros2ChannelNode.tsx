import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphChannel } from '../../ros2_apis/bridge_types';
import { channelKindColor, channelKindLabel } from './graphModel';

// A topic/service/action/interface, drawn as an ellipse. Same two-handle scheme
// as the node card. For an interface the primary line is "<joint>/<name>" and the
// sub-line is its command/state direction; otherwise it's the ROS name + type.
export default function Ros2ChannelNode({ data, selected }: NodeProps) {
  const channel = (data as { channel: GraphChannel }).channel;
  const color = channelKindColor(channel.kind);
  const isInterface = channel.kind === 'interface';

  const primary = isInterface
    ? `${channel.joint || '?'}/${channel.name || '?'}`
    : (channel.name || '(unnamed)');
  const secondary = isInterface
    ? (channel.direction === 'state' ? 'state' : 'command')
    : (channel.type || 'no type');

  return (
    <div
      className={`ros2-channel-node${selected ? ' selected' : ''}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <span className="ros2-channel-kind" style={{ color }}>{channelKindLabel(channel.kind)}</span>
      <span className="ros2-channel-name">{primary}</span>
      <span className="ros2-channel-type">{secondary}</span>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
