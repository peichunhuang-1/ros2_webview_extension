import type { FocusEntry, FocusState, InterfaceFocusEntry, GraphFocusEntry } from './bridge_types';

export const EMPTY_FOCUS: FocusState = { items: [], active: null };

export function sameEntry(a: FocusEntry, b: FocusEntry): boolean {
  if (a.source === 'interface' && b.source === 'interface') {
    return a.kind === b.kind && a.pkg === b.pkg && a.name === b.name;
  }
  if (a.source === 'graph' && b.source === 'graph') {
    return a.kind === b.kind && a.name === b.name;
  }
  return false;
}

export function isInterfaceFocus(e: FocusEntry): e is InterfaceFocusEntry {
  return e.source === 'interface';
}

export function isGraphFocus(e: FocusEntry): e is GraphFocusEntry {
  return e.source === 'graph';
}
