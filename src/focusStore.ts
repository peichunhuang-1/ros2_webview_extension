export type InterfaceKind = 'msg' | 'srv' | 'action';

export interface FocusEntry {
  kind: InterfaceKind;
  pkg:  string;
  name: string;
}

export interface FocusState {
  items:  FocusEntry[];
  active: FocusEntry | null;
}

function keyOf(e: FocusEntry): string {
  return `${e.kind}:${e.pkg}/${e.name}`;
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
