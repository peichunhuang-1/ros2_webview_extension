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
  // topic
  static CREATE_PUBLISHER  = "topic/publisher/create";
  static DESTROY_PUBLISHER = "topic/publisher/destroy";
  static CREATE_SUBSCRIBER  = "topic/subscriber/create";
  static DESTROY_SUBSCRIBER = "topic/subscriber/destroy";
  static PUBLISH_MESSAGE   = "topic/publish";
  static SUBSCRIBE_MESSAGE = "topic/subscribe";
  // service
  static CREATE_SERVICESERVER  = "service/server/create";
  static DESTROY_SERVICESERVER = "service/server/destroy";
  static CREATE_SERVICECLIENT  = "service/client/create";
  static DESTROY_SERVICECLIENT = "service/client/destroy";
  static REQUEST_SERVICE = "service/request";
  static REPLY_SERVICE   = "service/reply";
  // action
  static CREATE_ACTIONSERVER  = "action/server/create";
  static DESTROY_ACTIONSERVER = "action/server/destroy";
  static CREATE_ACTIONCLIENT  = "action/client/create";
  static DESTROY_ACTIONCLIENT = "action/client/destroy";
  static SENDGOAL_ACTION  = "action/send_goal";
  static FEEDBACK_ACTION  = "action/feedback";
  static RESULT_ACTION    = "action/result";
  static CANCEL_ACTION    = "action/cancel";
}

// --- QoS ---

export type QoSReliability = 'reliable' | 'best_effort';
export type QoSDurability  = 'volatile' | 'transient_local';
export type QoSHistory     = 'keep_last' | 'keep_all';

export type QoSProfile = {
  reliability?: QoSReliability;
  durability?:  QoSDurability;
  history?:     QoSHistory;
  depth?:       number;         // queue depth, used when history = 'keep_last'
};

// --- Topic ---

export type CreatePublisherRequestPayload = {
  topic:    string;
  msg_type: string;            // e.g. "geometry_msgs/msg/Twist"
  qos?:     QoSProfile;
};

export type DestroyPublisherRequestPayload = {
  topic: string;
};

export type CreateSubscriberRequestPayload = {
  topic:    string;
  msg_type: string;
  qos?:     QoSProfile;
};

export type DestroySubscriberRequestPayload = {
  topic: string;
};

export type TopicMessage = {
  type:    string;
  topic:   string;
  payload: Uint8Array;
};

// --- Service ---

export type CreateServiceServerRequestPayload = {
  service:      string;
  service_type: string;        // e.g. "example_interfaces/srv/AddTwoInts"
};

export type DestroyServiceServerRequestPayload = {
  service: string;
};

export type CreateServiceClientRequestPayload = {
  service:      string;
  service_type: string;
};

export type DestroyServiceClientRequestPayload = {
  service: string;
};

export type ServiceRequestPayload = {
  service: string;
  payload: Uint8Array;
};

// --- Action ---

export type CreateActionServerRequestPayload = {
  action:      string;
  action_type: string;         // e.g. "nav2_msgs/action/NavigateToPose"
};

export type DestroyActionServerRequestPayload = {
  action: string;
};

export type CreateActionClientRequestPayload = {
  action:      string;
  action_type: string;
};

export type DestroyActionClientRequestPayload = {
  action: string;
};

export type SendGoalPayload = {
  action:  string;
  goal_id: string;
  payload: Uint8Array;
};

export type CancelGoalPayload = {
  action:  string;
  goal_id: string;
};

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