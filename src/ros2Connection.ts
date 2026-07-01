import { isRos2Available, readMsgSchema, readSrvSchema, readActionSchema, type JsonSchema } from './schemaGen';

type ConnectionStatus = 'disconnected' | 'connected' | 'unavailable';

interface ConnectionState {
  status: ConnectionStatus;
  distro: string | null;
}

class Ros2Connection {
  private state: ConnectionState = { status: 'disconnected', distro: null };
  private schemaCache = new Map<string, JsonSchema>();

  connect(): ConnectionState {
    if (!isRos2Available()) {
      this.state = { status: 'unavailable', distro: null };
      return this.state;
    }
    this.state = {
      status: 'connected',
      distro: process.env.ROS_DISTRO ?? 'unknown',
    };
    return this.state;
  }

  disconnect(): void {
    this.state = { status: 'disconnected', distro: null };
    this.schemaCache.clear();
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  async getMsgSchema(pkg: string, name: string): Promise<JsonSchema> {
    const key = `msg:${pkg}/${name}`;
    if (this.schemaCache.has(key)) { return this.schemaCache.get(key)!; }
    const schema = await readMsgSchema(pkg, name);
    this.schemaCache.set(key, schema);
    return schema;
  }

  async getSrvSchema(pkg: string, name: string): Promise<JsonSchema> {
    const key = `srv:${pkg}/${name}`;
    if (this.schemaCache.has(key)) { return this.schemaCache.get(key)!; }
    const schema = await readSrvSchema(pkg, name);
    this.schemaCache.set(key, schema);
    return schema;
  }

  async getActionSchema(pkg: string, name: string): Promise<JsonSchema> {
    const key = `action:${pkg}/${name}`;
    if (this.schemaCache.has(key)) { return this.schemaCache.get(key)!; }
    const schema = await readActionSchema(pkg, name);
    this.schemaCache.set(key, schema);
    return schema;
  }
}

export const ros2Connection = new Ros2Connection();
export type { ConnectionState };
