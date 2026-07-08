// Message types + payload shapes for the webview <-> extension-host bridge.
//
// NOTE: the domain types here (FocusEntry, LayoutPanel, LayoutDocument, the
// interface/graph listing shapes) mirror the extension-host definitions in
// src/focusStore.ts, src/layoutTypes.ts, src/schemaGen.ts, and src/ros2Graph.ts.
// The two sides are separate TypeScript projects (this one is built by Vite,
// the extension by esbuild/tsc), so they can't import each other — when you
// change a shape on one side, update the other side to match.

export class VSCodePostTypeDefine {
  // connection
  static ROS2_CONNECT    = "ros2/connect";
  static ROS2_DISCONNECT = "ros2/disconnect";
  // schema (on-demand)
  static SCHEMA_MSG    = "ros2/schema/msg";
  static SCHEMA_SRV    = "ros2/schema/srv";
  static SCHEMA_ACTION = "ros2/schema/action";
  // interfaces
  static LIST_INTERFACES = "ros2/interfaces/list";
  // live graph (currently running topics/services/actions)
  static LIST_GRAPH = "ros2/graph/list";
  // focus (interfaces pinned/selected for Claude to read via MCP)
  static FOCUS_ADD        = "ros2/focus/add";
  static FOCUS_REMOVE     = "ros2/focus/remove";
  static FOCUS_SETACTIVE  = "ros2/focus/setActive";
  static FOCUS_LIST       = "ros2/focus/list";
  // layout editor (pushed messages + upload request, see layoutApi.ts)
  static LAYOUT_READY        = "layout/ready";
  static LAYOUT_INIT         = "layout/init";
  static LAYOUT_UPDATE       = "layout/update";
  static LAYOUT_UPLOAD_IMAGE = "layout/uploadImage";
  // node-graph editor (pushed messages, see graphApi.ts)
  static GRAPH_READY  = "graph/ready";
  static GRAPH_INIT   = "graph/init";
  static GRAPH_UPDATE = "graph/update";
}

// --- Connection / Schema ---

export type ConnectionStatus = 'disconnected' | 'connected' | 'unavailable';

export type ConnectResult = {
  status: ConnectionStatus;
  distro: string | null;
};

export type SchemaRequest = {
  pkg:  string;
  name: string;
};

export type SchemaResult = Record<string, unknown>;

// --- Interface listing ---

export type InterfaceKind = 'msg' | 'srv' | 'action';

export type InterfaceEntry = {
  pkg:  string;
  name: string;
};

export type InterfaceListResult = {
  msgs:    InterfaceEntry[];
  srvs:    InterfaceEntry[];
  actions: InterfaceEntry[];
};

// --- Live graph (currently running topics/services/actions) ---

export type GraphKind = 'topic' | 'service' | 'action';

export type GraphEntry = {
  name:  string;
  types: string[];
};

export type GraphListResult = {
  topics:   GraphEntry[];
  services: GraphEntry[];
  actions:  GraphEntry[];
};

// --- Focus (pinned interfaces/live graph entries, readable by Claude via MCP) ---

export type InterfaceFocusEntry = {
  source: 'interface';
  kind:   InterfaceKind;
  pkg:    string;
  name:   string;
};

export type GraphFocusEntry = {
  source: 'graph';
  kind:   GraphKind;
  name:   string;
  types:  string[];
};

export type FocusEntry = InterfaceFocusEntry | GraphFocusEntry;

export type FocusState = {
  items:  FocusEntry[];
  active: FocusEntry | null;
};

// --- Layout editor (2D panel-arrangement wireframe spec) ---

export type LayoutPanel = {
  id:      string;
  label:   string;
  x:       number;
  y:       number;
  width:   number;
  height:  number;
  bindings: FocusEntry[];
  image?:  string;
  notes?:  string;
  // Stacking order among overlapping panels — higher draws on top. Optional
  // so older layout files without it still parse; treat as 0 when absent.
  layer?:  number;
};

export type LayoutDocument = {
  version: 1;
  canvas:  { width: number; height: number; gridSize: number };
  panels:  LayoutPanel[];
};

// `imageUris` maps each panel's stored (workspace-relative) `image` path to a
// webview-safe URI — relative paths on disk aren't directly renderable as an
// <img src>, so the provider resolves them via `webview.asWebviewUri` and
// ships the resolved map alongside the raw document on every `layout/init`.
export type LayoutInitPayload = {
  doc:       LayoutDocument;
  imageUris: Record<string, string>;
};

export type UploadImageRequest = {
  dataUri:       string;
  suggestedName: string;
};

export type UploadImageResult = {
  relativePath: string;
  webviewUri:   string;
};

// --- Node-graph editor (ROS2 computation-graph architecture spec) ---
//
// Mirrors src/graphTypes.ts on the extension host — keep the two in sync.

export type NodeLanguage = 'cpp' | 'py' | 'rust';

export type GraphNode = {
  id:        string;
  name:      string;
  namespace: string;
  language:  NodeLanguage;
  x:         number;
  y:         number;
  notes?:    string;
};

export type ChannelKind = 'topic' | 'service' | 'action';

export type GraphChannel = {
  id:   string;
  kind: ChannelKind;
  name: string;
  type: string;
  x:    number;
  y:    number;
};

export type LinkRole =
  | 'publisher' | 'subscriber'
  | 'service_client' | 'service_server'
  | 'action_client' | 'action_server';

export type GraphLink = {
  id:        string;
  nodeId:    string;
  channelId: string;
  role:      LinkRole;
};

export type GraphDocument = {
  version:  1;
  nodes:    GraphNode[];
  channels: GraphChannel[];
  links:    GraphLink[];
};

export type GraphInitPayload = {
  doc: GraphDocument;
};