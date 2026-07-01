import { VSCode } from './bridge';
import { VSCodePostTypeDefine, type ConnectResult, type SchemaRequest, type SchemaResult } from './bridge_types';

export const ros2Api = {
  connect(): Promise<ConnectResult> {
    return VSCode.request<ConnectResult>(VSCodePostTypeDefine.ROS2_CONNECT);
  },

  disconnect(): Promise<boolean> {
    return VSCode.request<boolean>(VSCodePostTypeDefine.ROS2_DISCONNECT);
  },

  getMsgSchema(pkg: string, name: string): Promise<SchemaResult> {
    return VSCode.request<SchemaResult>(VSCodePostTypeDefine.SCHEMA_MSG, { pkg, name } satisfies SchemaRequest);
  },

  getSrvSchema(pkg: string, name: string): Promise<SchemaResult> {
    return VSCode.request<SchemaResult>(VSCodePostTypeDefine.SCHEMA_SRV, { pkg, name } satisfies SchemaRequest);
  },

  getActionSchema(pkg: string, name: string): Promise<SchemaResult> {
    return VSCode.request<SchemaResult>(VSCodePostTypeDefine.SCHEMA_ACTION, { pkg, name } satisfies SchemaRequest);
  },
};
