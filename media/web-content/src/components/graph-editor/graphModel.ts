import type { ChannelKind, LinkRole, NodeKind } from '../../ros2_apis/bridge_types';

// Pure helpers for the node-graph editor, mirroring src/graphTypes.ts on the
// extension host. No React/DOM here.

// The two roles valid for a channel kind, ordered [producer/initiator, consumer/provider]
// — i.e. [arrow source side, arrow target side].
export function linkRolesForKind(kind: ChannelKind): [LinkRole, LinkRole] {
  switch (kind) {
    case 'topic':     return ['publisher', 'subscriber'];
    case 'service':   return ['service_client', 'service_server'];
    case 'action':    return ['action_client', 'action_server'];
    case 'interface': return ['interface_exporter', 'interface_consumer'];
  }
}

// nodeIsProducer === true means the arrow runs node -> channel (publisher / client / action client).
export function roleFor(kind: ChannelKind, nodeIsProducer: boolean): LinkRole {
  const [producer, consumer] = linkRolesForKind(kind);
  return nodeIsProducer ? producer : consumer;
}

const ROLE_LABELS: Record<LinkRole, string> = {
  publisher:          'publishes',
  subscriber:         'subscribes',
  service_client:     'calls',
  service_server:     'serves',
  action_client:      'sends goals',
  action_server:      'executes',
  interface_exporter: 'exports',
  interface_consumer: 'claims',
};

export function roleLabel(role: LinkRole): string {
  return ROLE_LABELS[role];
}

// Whether a role puts the node on the producer/initiator (arrow-source) side —
// the first entry of each linkRolesForKind pair.
const PRODUCER_ROLES = new Set<LinkRole>([
  'publisher', 'service_client', 'action_client', 'interface_exporter',
]);

export function roleIsProducer(role: LinkRole): boolean {
  return PRODUCER_ROLES.has(role);
}

const CHANNEL_KIND_COLORS: Record<ChannelKind, string> = {
  topic:     '#3b82f6',
  service:   '#a855f7',
  action:    '#f59e0b',
  interface: '#10b981',
};

export function channelKindColor(kind: ChannelKind): string {
  return CHANNEL_KIND_COLORS[kind];
}

const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  topic:     'topic',
  service:   'service',
  action:    'action',
  interface: 'interface',
};

export function channelKindLabel(kind: ChannelKind): string {
  return CHANNEL_KIND_LABELS[kind];
}

const NODE_KIND_COLORS: Record<NodeKind, string> = {
  node:       '#64748b',
  controller: '#0ea5e9',
  hardware:   '#f97316',
};

export function nodeKindColor(kind: NodeKind): string {
  return NODE_KIND_COLORS[kind];
}
