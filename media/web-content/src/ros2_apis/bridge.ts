import { VSCodePostTypeDefine } from './bridge_types';
import type { TopicMessage } from './bridge_types';

function hasType<T extends { type: string }>(msg: unknown, type: T['type']): msg is T {
  return typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).type === type;
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class VSCode {
  private static vscode = acquireVsCodeApi();
  private static nextId = 0;
  private static pending = new Map<number, PendingRequest>();
  private static subscriberHandler: ((topic: string, data: unknown) => void) | null = null;
  
  static registerSubscriberHandler(fn: (topic: string, data: unknown) => void) {
    VSCode.subscriberHandler = fn;
  }

  static {
    window.addEventListener('message', (e) => {
      const msg = e.data;

      // request/response pipe
      if (msg.__id !== undefined && VSCode.pending.has(msg.__id)) {
        const entry = VSCode.pending.get(msg.__id)!;
        VSCode.pending.delete(msg.__id);
        clearTimeout(entry.timer);
        msg.error ? entry.reject(new Error(msg.error)) : entry.resolve(msg.result);
        return;
      }

      if (hasType<TopicMessage>(msg, VSCodePostTypeDefine.SUBSCRIBE_MESSAGE)) {
        VSCode.subscriberHandler?.(msg.topic, msg.payload);
        return;
      }
    });
  }

  static postMessage(msg: unknown): void {
    VSCode.vscode.postMessage(msg);
  }

  static onMessage(callback: (msg: unknown) => void): () => void {
    const handler = (e: MessageEvent) => callback(e.data);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  static request<T>(type: string, payload?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = VSCode.nextId++;
      const timer = setTimeout(() => {
        VSCode.pending.delete(id);
        reject(new Error(`Request '${type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      VSCode.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      VSCode.vscode.postMessage({ type, payload, timeoutMs, __id: id });
    });
  }
}