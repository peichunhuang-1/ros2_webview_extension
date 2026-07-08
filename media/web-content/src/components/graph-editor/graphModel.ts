import type { ChannelKind, LinkRole } from '../../ros2_apis/bridge_types';

// Pure helpers for the node-graph editor, mirroring src/graphTypes.ts on the
// extension host. No React/DOM here.

// The two roles valid for a channel kind, ordered [producer/initiator, consumer/provider]
// — i.e. [arrow source side, arrow target side].
export function linkRolesForKind(kind: ChannelKind): [LinkRole, LinkRole] {
  switch (kind) {
    case 'topic':   return ['publisher', 'subscriber'];
    case 'service': return ['service_client', 'service_server'];
    case 'action':  return ['action_client', 'action_server'];
  }
}

// nodeIsProducer === true means the arrow runs node -> channel (publisher / client / action client).
export function roleFor(kind: ChannelKind, nodeIsProducer: boolean): LinkRole {
  const [producer, consumer] = linkRolesForKind(kind);
  return nodeIsProducer ? producer : consumer;
}

const ROLE_LABELS: Record<LinkRole, string> = {
  publisher:       'publishes',
  subscriber:      'subscribes',
  service_client:  'calls',
  service_server:  'serves',
  action_client:   'sends goals',
  action_server:   'executes',
};

export function roleLabel(role: LinkRole): string {
  return ROLE_LABELS[role];
}

// Whether a role puts the node on the producer/initiator (arrow-source) side.
export function roleIsProducer(role: LinkRole): boolean {
  return role === 'publisher' || role === 'service_client' || role === 'action_client';
}

const KIND_COLORS: Record<ChannelKind, string> = {
  topic:   '#3b82f6',
  service: '#a855f7',
  action:  '#f59e0b',
};

export function channelKindColor(kind: ChannelKind): string {
  return KIND_COLORS[kind];
}
