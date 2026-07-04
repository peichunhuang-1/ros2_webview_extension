import { useEffect, useMemo, useState } from 'react';
import { ros2Api } from '../ros2_apis/ros2Api';
import type { FocusEntry, FocusState, InterfaceEntry, InterfaceFocusEntry, InterfaceKind, InterfaceListResult, SchemaResult } from '../ros2_apis/bridge_types';
import { EMPTY_FOCUS, sameEntry, isInterfaceFocus } from '../ros2_apis/focusUtils';
import { PlusIcon, TrashIcon } from './icons';
import './InterfaceBrowser.css';

const TABS: { kind: InterfaceKind; label: string }[] = [
  { kind: 'msg',    label: 'Messages' },
  { kind: 'srv',    label: 'Services' },
  { kind: 'action', label: 'Actions' },
];

function entriesFor(list: InterfaceListResult | null, kind: InterfaceKind): InterfaceEntry[] {
  if (!list) { return []; }
  return kind === 'msg' ? list.msgs : kind === 'srv' ? list.srvs : list.actions;
}

function fetchSchema(kind: InterfaceKind, pkg: string, name: string): Promise<SchemaResult> {
  if (kind === 'msg')    { return ros2Api.getMsgSchema(pkg, name); }
  if (kind === 'srv')    { return ros2Api.getSrvSchema(pkg, name); }
  return ros2Api.getActionSchema(pkg, name);
}

export default function InterfaceBrowser() {
  const [list, setList] = useState<InterfaceListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<InterfaceKind>('msg');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<InterfaceEntry | null>(null);
  const [schema, setSchema] = useState<SchemaResult | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [focus, setFocus] = useState<FocusState>(EMPTY_FOCUS);

  useEffect(() => {
    ros2Api.listInterfaces()
      .then(setList)
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
    ros2Api.listFocus().then(setFocus).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const entries = entriesFor(list, kind);
    const q = query.trim().toLowerCase();
    if (!q) { return entries; }
    return entries.filter(e => `${e.pkg}/${e.name}`.toLowerCase().includes(q));
  }, [list, kind, query]);

  function preview(previewKind: InterfaceKind, entry: InterfaceEntry) {
    setKind(previewKind);
    setSelected(entry);
    setSchema(null);
    setSchemaError(null);
    setShowJson(false);
    fetchSchema(previewKind, entry.pkg, entry.name)
      .then(setSchema)
      .catch(err => setSchemaError(err instanceof Error ? err.message : String(err)));
  }

  function selectTab(next: InterfaceKind) {
    setKind(next);
    setSelected(null);
    setSchema(null);
    setSchemaError(null);
  }

  function toggleFocus(entry: InterfaceEntry, isPinned: boolean) {
    const focusEntry: FocusEntry = { source: 'interface', kind, pkg: entry.pkg, name: entry.name };
    const request = isPinned ? ros2Api.removeFocus(focusEntry) : ros2Api.addFocus(focusEntry);
    request.then(setFocus).catch(() => {});
  }

  function selectFocusEntry(entry: InterfaceFocusEntry) {
    ros2Api.setActiveFocus(entry).then(setFocus).catch(() => {});
    preview(entry.kind, { pkg: entry.pkg, name: entry.name });
  }

  function removeFocusEntry(entry: FocusEntry) {
    ros2Api.removeFocus(entry).then(setFocus).catch(() => {});
  }

  if (loadError) {
    return <p className="hint interface-error">Failed to list interfaces: {loadError}</p>;
  }

  const interfaceFocusItems = focus.items.filter(isInterfaceFocus);

  return (
    <div className="interface-browser">
      {interfaceFocusItems.length > 0 && (
        <div className="focus-list">
          {interfaceFocusItems.map(entry => {
            const id = `${entry.kind}:${entry.pkg}/${entry.name}`;
            const isActive = focus.active !== null && sameEntry(focus.active, entry);
            return (
              <div key={id} className={`focus-chip ${isActive ? 'active' : ''}`}>
                <button className="focus-chip-label" onClick={() => selectFocusEntry(entry)} title="Set as focused for Claude">
                  <span className="focus-chip-kind">{entry.kind}</span>
                  <span className="interface-pkg">{entry.pkg}</span>
                  <span className="interface-sep">/</span>
                  <span className="interface-name">{entry.name}</span>
                </button>
                <button className="focus-chip-remove" onClick={() => removeFocusEntry(entry)} title="Remove from focus list">
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="interface-tabs">
        {TABS.map(tab => (
          <button
            key={tab.kind}
            className={`interface-tab ${kind === tab.kind ? 'active' : ''}`}
            onClick={() => selectTab(tab.kind)}
          >
            {tab.label}
            <span className="interface-count">{entriesFor(list, tab.kind).length}</span>
          </button>
        ))}
      </div>

      <input
        className="interface-search"
        type="text"
        placeholder={`Search ${TABS.find(t => t.kind === kind)!.label.toLowerCase()}…`}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <div className="interface-body">
        <ul className="interface-list">
          {list === null && <li className="interface-empty">Loading…</li>}
          {list !== null && filtered.length === 0 && (
            <li className="interface-empty">No matches</li>
          )}
          {filtered.map(entry => {
            const id = `${entry.pkg}/${entry.name}`;
            const isSelected = selected && selected.pkg === entry.pkg && selected.name === entry.name;
            const isPinned = interfaceFocusItems.some(i => i.kind === kind && i.pkg === entry.pkg && i.name === entry.name);
            return (
              <li key={id} className="interface-row">
                <button
                  className={`interface-item ${isSelected ? 'active' : ''}`}
                  onClick={() => preview(kind, entry)}
                >
                  <span className="interface-pkg">{entry.pkg}</span>
                  <span className="interface-sep">/</span>
                  <span className="interface-name">{entry.name}</span>
                </button>
                <button
                  className={`interface-focus-toggle ${isPinned ? 'pinned' : ''}`}
                  onClick={() => toggleFocus(entry, isPinned)}
                  title={isPinned ? 'Remove from focus list' : 'Add to focus list'}
                >
                  {isPinned ? <TrashIcon /> : <PlusIcon />}
                </button>
              </li>
            );
          })}
        </ul>

        {selected && (
          <div className="interface-preview">
            <div className="interface-preview-title">
              <span>{selected.pkg}/{selected.name}</span>
              {schema && (
                <button className="json-toggle" onClick={() => setShowJson(v => !v)}>
                  {showJson ? 'Hide JSON' : 'Show JSON'}
                </button>
              )}
            </div>
            {schemaError && <p className="hint interface-error">{schemaError}</p>}
            {!schemaError && !schema && <p className="hint">Loading schema…</p>}
            {schema && showJson && <pre className="interface-schema">{JSON.stringify(schema, null, 2)}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
