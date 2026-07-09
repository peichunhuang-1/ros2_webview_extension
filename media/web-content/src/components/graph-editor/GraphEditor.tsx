import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, addEdge, useEdgesState, useNodesState, MarkerType,
  type Connection, type Edge, type Node, type NodeTypes, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphApi } from '../../ros2_apis/graphApi';
import type {
  ChannelKind, GraphChannel, GraphDocument, GraphNode, LinkRole, NodeKind,
} from '../../ros2_apis/bridge_types';
import { roleFor, roleIsProducer, roleLabel } from './graphModel';
import Ros2NodeCard from './Ros2NodeCard';
import Ros2ChannelNode from './Ros2ChannelNode';
import NodeDetailModal from './NodeDetailModal';
import ChannelDetailModal from './ChannelDetailModal';
import '../LayoutEditor.css';
import './GraphEditor.css';

const nodeTypes: NodeTypes = { ros2node: Ros2NodeCard, ros2channel: Ros2ChannelNode };

type LinkData = { nodeId: string; channelId: string; role: LinkRole };

// --- GraphDocument <-> React Flow conversions --------------------------------

function docToRfNodes(doc: GraphDocument): Node[] {
  return [
    ...doc.nodes.map(n => ({ id: n.id, type: 'ros2node', position: { x: n.x, y: n.y }, data: { node: n } })),
    ...doc.channels.map(c => ({ id: c.id, type: 'ros2channel', position: { x: c.x, y: c.y }, data: { channel: c } })),
  ];
}

function docToRfEdges(doc: GraphDocument): Edge[] {
  return doc.links.map(l => {
    // The producer/initiator side is the arrow source, so a publisher/client
    // runs node -> channel and a subscriber/server runs channel -> node.
    const producer = roleIsProducer(l.role);
    return {
      id: l.id,
      source: producer ? l.nodeId : l.channelId,
      target: producer ? l.channelId : l.nodeId,
      sourceHandle: 'out',
      targetHandle: 'in',
      label: roleLabel(l.role),
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { nodeId: l.nodeId, channelId: l.channelId, role: l.role } satisfies LinkData,
    };
  });
}

function rfToDoc(nodes: Node[], edges: Edge[]): GraphDocument {
  const gnodes: GraphNode[] = [];
  const gchannels: GraphChannel[] = [];
  for (const n of nodes) {
    if (n.type === 'ros2node') {
      gnodes.push({ ...(n.data as { node: GraphNode }).node, x: n.position.x, y: n.position.y });
    } else {
      gchannels.push({ ...(n.data as { channel: GraphChannel }).channel, x: n.position.x, y: n.position.y });
    }
  }
  const links = edges.map(e => {
    const d = e.data as LinkData;
    return { id: e.id, nodeId: d.nodeId, channelId: d.channelId, role: d.role };
  });
  return { version: 1, nodes: gnodes, channels: gchannels, links };
}

// New items are placed on a short diagonal cascade so successive adds don't
// stack exactly on top of each other.
function spawnPosition(count: number): { x: number; y: number } {
  const step = count % 6;
  return { x: 80 + step * 48, y: 80 + step * 48 };
}

export default function GraphEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editing, setEditing] = useState<{ kind: 'node' | 'channel'; id: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Suppress pushing while applying an externally-pushed document (init/undo),
  // otherwise we'd immediately echo it straight back to the provider.
  const applyingExternal = useRef(false);
  const pushPending = useRef(false);

  // Serialize the current graph and send it to the provider once, after the
  // pending render commits. Coalesces multiple mutations in one tick into a
  // single document write — and, crucially, is NOT called on every drag frame
  // (only on drag stop), so dragging doesn't spam the text document. The latest
  // node/edge arrays are read via no-op functional setState updaters, which run
  // against current state regardless of render/effect timing.
  function schedulePush() {
    if (applyingExternal.current || pushPending.current) { return; }
    pushPending.current = true;
    requestAnimationFrame(() => {
      pushPending.current = false;
      let latestNodes: Node[] = [];
      let latestEdges: Edge[] = [];
      setNodes(ns => { latestNodes = ns; return ns; });
      setEdges(es => { latestEdges = es; return es; });
      graphApi.update(rfToDoc(latestNodes, latestEdges));
    });
  }

  useEffect(() => {
    const unsubscribe = graphApi.onInit(({ doc }) => {
      applyingExternal.current = true;
      setNodes(docToRfNodes(doc));
      setEdges(docToRfEdges(doc));
      setLoaded(true);
      requestAnimationFrame(() => { applyingExternal.current = false; });
    });
    graphApi.ready();
    return unsubscribe;
  }, [setNodes, setEdges]);

  const nodeIdSet = useMemo(
    () => new Set(nodes.filter(n => n.type === 'ros2node').map(n => n.id)),
    [nodes],
  );
  const channelById = useMemo(() => {
    const m = new Map<string, GraphChannel>();
    for (const n of nodes) {
      if (n.type === 'ros2channel') { m.set(n.id, (n.data as { channel: GraphChannel }).channel); }
    }
    return m;
  }, [nodes]);

  // A link is valid iff it connects exactly one node to exactly one channel —
  // never node-to-node or channel-to-channel.
  function isValidConnection(c: Connection | Edge): boolean {
    if (!c.source || !c.target || c.source === c.target) { return false; }
    return nodeIdSet.has(c.source) !== nodeIdSet.has(c.target);
  }

  const onConnect: OnConnect = (params) => {
    const { source, target } = params;
    if (!source || !target) { return; }
    const sourceIsNode = nodeIdSet.has(source);
    if (sourceIsNode === nodeIdSet.has(target)) { return; }

    const nodeId = sourceIsNode ? source : target;
    const channelId = sourceIsNode ? target : source;
    const channel = channelById.get(channelId);
    if (!channel) { return; }

    // The node used its source ("out") handle iff it's the connection source,
    // which means it produces/initiates on this channel.
    const role = roleFor(channel.kind, sourceIsNode);
    const duplicate = edges.some(e => {
      const d = e.data as LinkData;
      return d.nodeId === nodeId && d.channelId === channelId && d.role === role;
    });
    if (duplicate) { return; }

    const edge: Edge = {
      id: crypto.randomUUID(),
      source,
      target,
      sourceHandle: params.sourceHandle ?? 'out',
      targetHandle: params.targetHandle ?? 'in',
      label: roleLabel(role),
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { nodeId, channelId, role } satisfies LinkData,
    };
    setEdges(es => addEdge(edge, es));
    schedulePush();
  };

  function addNode(kind: NodeKind) {
    const id = crypto.randomUUID();
    const pos = spawnPosition(nodes.length);
    const node: GraphNode = { id, kind, name: `new_${kind}`, namespace: '/', language: 'cpp', x: pos.x, y: pos.y };
    setNodes(ns => [...ns, { id, type: 'ros2node', position: pos, data: { node } }]);
    schedulePush();
    setEditing({ kind: 'node', id });
  }

  function addChannel(kind: ChannelKind) {
    const id = crypto.randomUUID();
    const pos = spawnPosition(nodes.length);
    const channel: GraphChannel = { id, kind, name: '', type: '', x: pos.x, y: pos.y };
    setNodes(ns => [...ns, { id, type: 'ros2channel', position: pos, data: { channel } }]);
    schedulePush();
    setEditing({ kind: 'channel', id });
  }

  function updateNodeData(id: string, changes: Partial<GraphNode>) {
    setNodes(ns => ns.map(n =>
      n.id === id && n.type === 'ros2node'
        ? { ...n, data: { node: { ...(n.data as { node: GraphNode }).node, ...changes } } }
        : n,
    ));
    schedulePush();
  }

  function updateChannelData(id: string, changes: Partial<GraphChannel>) {
    setNodes(ns => ns.map(n =>
      n.id === id && n.type === 'ros2channel'
        ? { ...n, data: { channel: { ...(n.data as { channel: GraphChannel }).channel, ...changes } } }
        : n,
    ));
    // Changing a channel's kind invalidates its links' role names (e.g. a
    // "publisher" on a topic must become a "service_client" on a service).
    // Remap each affected link, preserving which side (producer vs consumer).
    if (changes.kind) {
      setEdges(es => es.map(e => {
        const d = e.data as LinkData;
        if (d.channelId !== id) { return e; }
        const role = roleFor(changes.kind!, roleIsProducer(d.role));
        return { ...e, label: roleLabel(role), data: { ...d, role } };
      }));
    }
    schedulePush();
  }

  function deleteById(id: string) {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => {
      const d = e.data as LinkData;
      return d.nodeId !== id && d.channelId !== id;
    }));
    setEditing(null);
    schedulePush();
  }

  const editingNode = editing?.kind === 'node'
    ? nodes.find(n => n.id === editing.id)
    : undefined;
  const editingChannel = editing?.kind === 'channel'
    ? nodes.find(n => n.id === editing.id)
    : undefined;

  if (!loaded) {
    return <div className="graph-editor"><p className="hint">Loading graph…</p></div>;
  }

  return (
    <div className="graph-editor">
      <header className="layout-toolbar">
        <div className="layout-toolbar-left">
          <span className="title">Architecture Graph</span>
        </div>
        <div className="layout-toolbar-right graph-toolbar-actions">
          <button className="layout-add-btn" onClick={() => addNode('node')}>+ Node</button>
          <button className="layout-add-btn" onClick={() => addNode('controller')}>+ Controller</button>
          <button className="layout-add-btn" onClick={() => addNode('hardware')}>+ Hardware</button>
          <span className="graph-toolbar-sep" />
          <button className="layout-add-btn" onClick={() => addChannel('topic')}>+ Topic</button>
          <button className="layout-add-btn" onClick={() => addChannel('service')}>+ Service</button>
          <button className="layout-add-btn" onClick={() => addChannel('action')}>+ Action</button>
          <button className="layout-add-btn" onClick={() => addChannel('control')}>+ Control</button>
          <button className="layout-add-btn" onClick={() => addChannel('hardware_interface')}>+ HW Interface</button>
        </div>
      </header>

      <div className="graph-editor-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeDragStop={schedulePush}
          onNodesDelete={schedulePush}
          onEdgesDelete={schedulePush}
          onNodeDoubleClick={(_e, n) => setEditing({ kind: n.type === 'ros2node' ? 'node' : 'channel', id: n.id })}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
      </div>

      {editingNode && (
        <NodeDetailModal
          node={(editingNode.data as { node: GraphNode }).node}
          onChange={changes => updateNodeData(editingNode.id, changes)}
          onClose={() => setEditing(null)}
          onDelete={() => deleteById(editingNode.id)}
        />
      )}
      {editingChannel && (
        <ChannelDetailModal
          channel={(editingChannel.data as { channel: GraphChannel }).channel}
          onChange={changes => updateChannelData(editingChannel.id, changes)}
          onClose={() => setEditing(null)}
          onDelete={() => deleteById(editingChannel.id)}
        />
      )}
    </div>
  );
}
