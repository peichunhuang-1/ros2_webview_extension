import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '../../ros2_apis/bridge_types';

const LANGUAGE_LABELS: Record<GraphNode['language'], string> = {
  cpp: 'C++', py: 'Python', rust: 'Rust',
};

// A ROS2 node, drawn as a rectangle. Two handles: a source ("out", right) used
// when the node produces/initiates on a channel (publisher/client), and a
// target ("in", left) used when it consumes/provides (subscriber/server).
export default function Ros2NodeCard({ data, selected }: NodeProps) {
  const node = (data as { node: GraphNode }).node;
  const fullName = (node.namespace === '/' || !node.namespace)
    ? `/${node.name}`
    : `${node.namespace.replace(/\/$/, '')}/${node.name}`;

  return (
    <div className={`ros2-node-card${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <div className="ros2-node-card-name">{node.name || '(unnamed)'}</div>
      <div className="ros2-node-card-meta">
        <span className="ros2-node-card-ns">{fullName}</span>
        <span className="ros2-node-card-lang">{LANGUAGE_LABELS[node.language]}</span>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
