export type InterfaceFocusKind = 'msg' | 'srv' | 'action';
export type GraphFocusKind = 'topic' | 'service' | 'action';

// An installed interface definition, e.g. geometry_msgs/Twist.
export interface InterfaceFocusEntry {
  source: 'interface';
  kind:   InterfaceFocusKind;
  pkg:    string;
  name:   string;
}

// A topic/service/action currently running in the live ROS2 graph.
export interface GraphFocusEntry {
  source: 'graph';
  kind:   GraphFocusKind;
  name:   string;
  types:  string[];
}

export type FocusEntry = InterfaceFocusEntry | GraphFocusEntry;

export interface FocusState {
  items:  FocusEntry[];
  active: FocusEntry | null;
}

function keyOf(e: FocusEntry): string {
  return e.source === 'interface' ? `interface:${e.kind}:${e.pkg}/${e.name}` : `graph:${e.kind}:${e.name}`;
}

class FocusStore {
  private items: FocusEntry[] = [];
  private activeKey: string | null = null;

  add(entry: FocusEntry): FocusState {
    if (!this.items.some(i => keyOf(i) === keyOf(entry))) {
      this.items.push(entry);
    }
    if (this.activeKey === null) {
      this.activeKey = keyOf(entry);
    }
    return this.getState();
  }

  remove(entry: FocusEntry): FocusState {
    const key = keyOf(entry);
    this.items = this.items.filter(i => keyOf(i) !== key);
    if (this.activeKey === key) {
      this.activeKey = null;
    }
    return this.getState();
  }

  setActive(entry: FocusEntry): FocusState {
    if (this.items.some(i => keyOf(i) === keyOf(entry))) {
      this.activeKey = keyOf(entry);
    }
    return this.getState();
  }

  getState(): FocusState {
    return {
      items:  this.items,
      active: this.items.find(i => keyOf(i) === this.activeKey) ?? null,
    };
  }
}

export const focusStore = new FocusStore();
