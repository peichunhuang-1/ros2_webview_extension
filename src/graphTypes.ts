// Schema for the ROS2 node-graph architecture designer (`.ros2graph.json`).
//
// This is the "backend" companion to the `.ros2ui.json` UI layout: instead of
// arranging GUI panels, it describes the ROS2 computation graph — which nodes
// exist and how they connect through topics/services/actions — so an agent can
// later scaffold the actual node packages from it (see CLAUDE.md guidance).
//
// Three primitives, kept deliberately flat so the file is easy to diff and easy
// for an agent to read:
//   - GraphNode    — a ROS2 node (drawn as a rectangle)
//   - GraphChannel — a topic/service/action (drawn as an ellipse); carries the
//                    single message/service/action *type* that is its contract
//   - GraphLink    — connects one node to one channel, with a `role` that
//                    encodes both which side and the data direction
//
// A topic being many-to-many (N publishers, M subscribers) falls out for free:
// it's just many links pointing at the same channel. Services/actions are
// directional, which the role names capture.

export type NodeLanguage = 'cpp' | 'py' | 'rust';

export interface GraphNode {
  id:         string;
  name:       string;
  namespace:  string;
  language:   NodeLanguage;
  x:          number;
  y:          number;
  notes?:     string;
}

export type ChannelKind = 'topic' | 'service' | 'action';

export interface GraphChannel {
  id:    string;
  kind:  ChannelKind;
  name:  string;
  // The interface type string, e.g. "geometry_msgs/msg/Twist",
  // "example_interfaces/srv/AddTwoInts", "action_tutorials_interfaces/action/Fibonacci".
  // Empty until the user picks one — a channel can be placed before its type is chosen.
  type:  string;
  x:     number;
  y:     number;
}

// Role of a node on a channel. The producer/initiator side (publisher, client)
// is the one the connection arrow points *away* from; the consumer/provider
// side (subscriber, server) is where it points *to*. Which pair is valid
// depends on the channel kind (see roleFor / linkRolesForKind).
export type LinkRole =
  | 'publisher' | 'subscriber'
  | 'service_client' | 'service_server'
  | 'action_client' | 'action_server';

export interface GraphLink {
  id:        string;
  nodeId:    string;
  channelId: string;
  role:      LinkRole;
}

export interface GraphDocument {
  version:  1;
  nodes:    GraphNode[];
  channels: GraphChannel[];
  links:    GraphLink[];
}

export function emptyGraphDocument(): GraphDocument {
  return { version: 1, nodes: [], channels: [], links: [] };
}

// The two roles valid for a channel kind, ordered [producer/initiator, consumer/provider]
// — i.e. [arrow source side, arrow target side].
export function linkRolesForKind(kind: ChannelKind): [LinkRole, LinkRole] {
  switch (kind) {
    case 'topic':   return ['publisher', 'subscriber'];
    case 'service': return ['service_client', 'service_server'];
    case 'action':  return ['action_client', 'action_server'];
  }
}

// Resolves the role for a new link from the channel kind and the data direction:
// nodeIsProducer === true means the arrow runs node -> channel (publisher / client / action client).
export function roleFor(kind: ChannelKind, nodeIsProducer: boolean): LinkRole {
  const [producer, consumer] = linkRolesForKind(kind);
  return nodeIsProducer ? producer : consumer;
}

// Tolerant of older/partial files and hand edits: backfills any missing top-level
// array and drops links that reference a node/channel that no longer exists, so
// downstream code (and the editor) can rely on the shape being consistent.
export function parseGraphDocumentText(text: string): GraphDocument {
  const trimmed = text.trim();
  if (!trimmed) { return emptyGraphDocument(); }
  try {
    const doc = JSON.parse(trimmed) as Partial<GraphDocument>;
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    const channels = Array.isArray(doc.channels) ? doc.channels : [];
    const nodeIds = new Set(nodes.map(n => n.id));
    const channelIds = new Set(channels.map(c => c.id));
    const links = (Array.isArray(doc.links) ? doc.links : [])
      .filter(l => nodeIds.has(l.nodeId) && channelIds.has(l.channelId));
    return { version: 1, nodes, channels, links };
  } catch {
    return emptyGraphDocument();
  }
}
