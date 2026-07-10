import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, addEdge, useEdgesState, useNodesState, MarkerType,
  type Connection, type Edge, type Node, type NodeTypes, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphApi } from '../../ros2_apis/graphApi';
import type {
  ChannelKind, GraphChannel, GraphDocument, GraphLink, GraphNode, LinkRole, NodeKind,
} from '../../ros2_apis/bridge_types';
import { roleFor, roleIsProducer, roleLabel } from './graphModel';
import Ros2NodeCard from './Ros2NodeCard';
import Ros2ChannelNode from './Ros2ChannelNode';
import NodeDetailModal from './NodeDetailModal';
import ChannelDetailModal from './ChannelDetailModal';
import LinkDetailModal from './LinkDetailModal';
import '../LayoutEditor.css';
import './GraphEditor.css';

const nodeTypes: NodeTypes = { ros2node: Ros2NodeCard, ros2channel: Ros2ChannelNode };

// Everything about a link except its id lives on the React Flow edge's `data`,
// so per-connection properties (rate/qos/notes) round-trip through the editor.
type LinkData = Omit<GraphLink, 'id'>;

// --- GraphDocument <-> React Flow conversions --------------------------------

// One place that turns a link into a React Flow edge, so a freshly-connected
// edge and a reloaded one are always built identically. The producer/initiator
// side is the arrow source: a publisher/client/exporter runs node -> channel, a
// subscriber/server/consumer runs channel -> node.
function linkToEdge(link: GraphLink): Edge {
  const producer = roleIsProducer(link.role);
  const { id, ...data } = link;
  return {
    id,
    source: producer ? link.nodeId : link.channelId,
    target: producer ? link.channelId : link.nodeId,
    sourceHandle: 'out',
    targetHandle: 'in',
    label: roleLabel(link.role),
    markerEnd: { type: MarkerType.ArrowClosed },
    data,
  };
}

function docToRfNodes(doc: GraphDocument): Node[] {
  return [
    ...doc.nodes.map(n => ({ id: n.id, type: 'ros2node', position: { x: n.x, y: n.y }, data: { node: n } })),
    ...doc.channels.map(c => ({ id: c.id, type: 'ros2channel', position: { x: c.x, y: c.y }, data: { channel: c } })),
  ];
}

function docToRfEdges(doc: GraphDocument): Edge[] {
  return doc.links.map(linkToEdge);
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
  const links = edges.map(e => ({ id: e.id, ...(e.data as LinkData) }));
  return { version: 1, nodes: gnodes, channels: gchannels, links };
}

// New items are placed on a short diagonal cascade so successive adds don't
// stack exactly on top of each other.
function spawnPosition(count: number): { x: number; y: number } {
  const step = count % 6;
  return { x: 80 + step * 48, y: 80 + step * 48 };
}

// The role a node plays on a channel. For a ros2_control interface it's fixed by
// the node's kind (hardware exports it, everything else claims it); for the ROS2
// primitives it follows the arrow direction the user dragged.
function roleForConnection(node: GraphNode, channel: GraphChannel, nodeIsProducer: boolean): LinkRole {
  if (channel.kind === 'interface') {
    return node.kind === 'hardware' ? 'interface_exporter' : 'interface_consumer';
  }
  return roleFor(channel.kind, nodeIsProducer);
}

export default function GraphEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editing, setEditing] = useState<{ kind: 'node' | 'channel' | 'link'; id: string } | null>(null);
  const [addMenu, setAddMenu] = useState<null | 'node' | 'channel'>(null);
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
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) {
      if (n.type === 'ros2node') { m.set(n.id, (n.data as { node: GraphNode }).node); }
    }
    return m;
  }, [nodes]);
  const channelById = useMemo(() => {
    const m = new Map<string, GraphChannel>();
    for (const n of nodes) {
      if (n.type === 'ros2channel') { m.set(n.id, (n.data as { channel: GraphChannel }).channel); }
    }
    return m;
  }, [nodes]);

  // ros2_control rule: an interface is exported by exactly one hardware
  // component, so a second hardware link to the same interface would mean
  // hardware wired to hardware — disallowed.
  function wouldDoubleExportHardware(nodeId: string, channelId: string): boolean {
    const node = nodeById.get(nodeId);
    const channel = channelById.get(channelId);
    if (channel?.kind !== 'interface' || node?.kind !== 'hardware') { return false; }
    return edges.some(e => {
      const d = e.data as LinkData;
      return d.channelId === channelId && d.role === 'interface_exporter';
    });
  }

  // A link is valid iff it connects exactly one node to exactly one channel
  // (never node-to-node or channel-to-channel) and doesn't wire two hardware
  // components onto the same interface.
  function isValidConnection(c: Connection | Edge): boolean {
    if (!c.source || !c.target || c.source === c.target) { return false; }
    const sourceIsNode = nodeIdSet.has(c.source);
    if (sourceIsNode === nodeIdSet.has(c.target)) { return false; }
    const nodeId = sourceIsNode ? c.source : c.target;
    const channelId = sourceIsNode ? c.target : c.source;
    return !wouldDoubleExportHardware(nodeId, channelId);
  }

  const onConnect: OnConnect = (params) => {
    const { source, target } = params;
    if (!source || !target) { return; }
    const sourceIsNode = nodeIdSet.has(source);
    if (sourceIsNode === nodeIdSet.has(target)) { return; }

    const nodeId = sourceIsNode ? source : target;
    const channelId = sourceIsNode ? target : source;
    const node = nodeById.get(nodeId);
    const channel = channelById.get(channelId);
    if (!node || !channel) { return; }
    if (wouldDoubleExportHardware(nodeId, channelId)) { return; }

    // The node used its source ("out") handle iff it's the connection source,
    // which means it produces/initiates on this channel.
    const role = roleForConnection(node, channel, sourceIsNode);
    const duplicate = edges.some(e => {
      const d = e.data as LinkData;
      return d.nodeId === nodeId && d.channelId === channelId && d.role === role;
    });
    if (duplicate) { return; }

    setEdges(es => addEdge(linkToEdge({ id: crypto.randomUUID(), nodeId, channelId, role }), es));
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
    const channel: GraphChannel = kind === 'interface'
      ? { id, kind, name: '', type: '', joint: '', direction: 'command', x: pos.x, y: pos.y }
      : { id, kind, name: '', type: '', x: pos.x, y: pos.y };
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
    // Changing a channel's kind invalidates its links' roles (e.g. a "publisher"
    // on a topic must become a "service_client" on a service, or an interface
    // role decided by node kind). Rebuild each affected edge accordingly.
    if (changes.kind) {
      const newKind = changes.kind;
      setEdges(es => es.map(e => {
        const d = e.data as LinkData;
        if (d.channelId !== id) { return e; }
        const role = newKind === 'interface'
          ? (nodeById.get(d.nodeId)?.kind === 'hardware' ? 'interface_exporter' : 'interface_consumer')
          : roleFor(newKind, roleIsProducer(d.role));
        return linkToEdge({ ...d, id: e.id, role });
      }));
    }
    schedulePush();
  }

  function updateLinkData(id: string, changes: Partial<GraphLink>) {
    setEdges(es => es.map(e => {
      if (e.id !== id) { return e; }
      return linkToEdge({ ...(e.data as LinkData), id, ...changes });
    }));
    schedulePush();
  }

  function deleteLinkById(id: string) {
    setEdges(es => es.filter(e => e.id !== id));
    setEditing(null);
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
  const editingLink = (() => {
    if (editing?.kind !== 'link') { return undefined; }
    const edge = edges.find(e => e.id === editing.id);
    if (!edge) { return undefined; }
    const d = edge.data as LinkData;
    const node = nodeById.get(d.nodeId);
    const channel = channelById.get(d.channelId);
    if (!node || !channel) { return undefined; }
    return { link: { id: edge.id, ...d } as GraphLink, node, channel };
  })();

  if (!loaded) {
    return <div className="graph-editor"><p className="hint">Loading graph…</p></div>;
  }

  return (
    // Clicking anywhere outside an open add-menu dismisses it (the menu/groups
    // below stop propagation so their own clicks don't trigger this).
    <div className="graph-editor" onClick={() => setAddMenu(null)}>
      <header className="layout-toolbar">
        <div className="layout-toolbar-left">
          <span className="title">Architecture Graph</span>
        </div>
        <div className="layout-toolbar-right graph-toolbar-actions" onClick={e => e.stopPropagation()}>
          <div className="graph-add-group">
            <button className="layout-add-btn" onClick={() => setAddMenu(m => (m === 'node' ? null : 'node'))}>+ Component ▾</button>
            {addMenu === 'node' && (
              <div className="graph-add-menu">
                <button onClick={() => { addNode('node'); setAddMenu(null); }}>Node</button>
                <button onClick={() => { addNode('controller'); setAddMenu(null); }}>Controller</button>
                <button onClick={() => { addNode('hardware'); setAddMenu(null); }}>Hardware</button>
              </div>
            )}
          </div>
          <div className="graph-add-group">
            <button className="layout-add-btn" onClick={() => setAddMenu(m => (m === 'channel' ? null : 'channel'))}>+ Channel ▾</button>
            {addMenu === 'channel' && (
              <div className="graph-add-menu">
                <button onClick={() => { addChannel('topic'); setAddMenu(null); }}>Topic</button>
                <button onClick={() => { addChannel('service'); setAddMenu(null); }}>Service</button>
                <button onClick={() => { addChannel('action'); setAddMenu(null); }}>Action</button>
                <button onClick={() => { addChannel('interface'); setAddMenu(null); }}>Interface</button>
              </div>
            )}
          </div>
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
          onEdgeDoubleClick={(_e, edge) => setEditing({ kind: 'link', id: edge.id })}
          onPaneClick={() => setAddMenu(null)}
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
      {editingLink && (
        <LinkDetailModal
          link={editingLink.link}
          node={editingLink.node}
          channel={editingLink.channel}
          onChange={changes => updateLinkData(editingLink.link.id, changes)}
          onClose={() => setEditing(null)}
          onDelete={() => deleteLinkById(editingLink.link.id)}
        />
      )}
    </div>
  );
}
