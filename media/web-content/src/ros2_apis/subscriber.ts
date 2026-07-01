import { unpack } from 'msgpackr';
import { VSCode } from './bridge';
import { VSCodePostTypeDefine, type CreateSubscriberRequestPayload } from './bridge_types';

type Callback = (msg: any) => void;

export class Subscriber {
  private static registry = new Map<string, Set<Subscriber>>();

  private topic_: string;
  private is_valid_: boolean = false;
  private callbacks_: Callback[] = [];

  constructor(topic: string) {
    this.topic_ = topic;
    const request: CreateSubscriberRequestPayload = {
      topic: topic,
      msg_type: 'std_msgs/String',
    };
    VSCode.request<boolean>(VSCodePostTypeDefine.CREATE_SUBSCRIBER, request)
      .then((res) => { this.is_valid_ = res; })
      .catch(console.error);

    if (!Subscriber.registry.has(topic)) {
      Subscriber.registry.set(topic, new Set());
    }
    Subscriber.registry.get(topic)!.add(this);
  }

  // called by bridge.ts for every incoming topic message
  static dispatch(topic: string, raw: unknown): void {
    const data = raw instanceof ArrayBuffer ? unpack(new Uint8Array(raw)) : raw;
    Subscriber.registry.get(topic)?.forEach(sub => sub.receive(data));
  }

  private receive(data: any): void {
    this.callbacks_.forEach(cb => cb(data));
  }

  // push-based: register a callback
  onMessage(cb: Callback): () => void {
    this.callbacks_.push(cb);
    return () => { this.callbacks_ = this.callbacks_.filter(c => c !== cb); };
  }

  is_valid(): boolean { return this.is_valid_; }

  destroy(): void {
    Subscriber.registry.get(this.topic_)?.delete(this);
    VSCode.postMessage({ type: 'subscriber/destroy', topic: this.topic_ });
  }
}


VSCode.registerSubscriberHandler((topic, data) => Subscriber.dispatch(topic, data));