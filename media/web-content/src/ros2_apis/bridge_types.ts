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
  // focus (interfaces pinned/selected for Claude to read via MCP)
  static FOCUS_ADD        = "ros2/focus/add";
  static FOCUS_REMOVE     = "ros2/focus/remove";
  static FOCUS_SETACTIVE  = "ros2/focus/setActive";
  static FOCUS_LIST       = "ros2/focus/list";
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

// --- Focus (pinned interfaces, readable by Claude via MCP) ---

export type FocusEntry = {
  kind: InterfaceKind;
  pkg:  string;
  name: string;
};

export type FocusState = {
  items:  FocusEntry[];
  active: FocusEntry | null;
};