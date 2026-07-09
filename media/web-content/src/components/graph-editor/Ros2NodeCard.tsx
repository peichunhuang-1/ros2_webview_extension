import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '../../ros2_apis/bridge_types';
import { nodeKindColor } from './graphModel';

const LANGUAGE_LABELS: Record<GraphNode['language'], string> = {
  cpp: 'C++', py: 'Python', rust: 'Rust',
};

// A ROS2 node / controller / hardware component, drawn as a rectangle. Two
// handles: a source ("out", right) used when it produces/initiates on a channel
// (publisher/client/writer/exporter), and a target ("in", left) used when it
// consumes/provides (subscriber/server/reader/consumer). The left border is
// tinted by kind so controllers and hardware read as distinct at a glance.
export default function Ros2NodeCard({ data, selected }: NodeProps) {
  const node = (data as { node: GraphNode }).node;
  const fullName = (node.namespace === '/' || !node.namespace)
    ? `/${node.name}`
    : `${node.namespace.replace(/\/$/, '')}/${node.name}`;
  const kindColor = nodeKindColor(node.kind);

  return (
    <div
      className={`ros2-node-card${selected ? ' selected' : ''}`}
      style={{ borderLeftColor: kindColor, borderLeftWidth: 3 }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="ros2-node-card-top">
        <span className="ros2-node-card-kind" style={{ color: kindColor }}>{node.kind}</span>
        <span className="ros2-node-card-lang">{LANGUAGE_LABELS[node.language]}</span>
      </div>
      <div className="ros2-node-card-name">{node.name || '(unnamed)'}</div>
      <div className="ros2-node-card-ns">{fullName}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
