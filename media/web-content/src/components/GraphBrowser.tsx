import { useEffect, useMemo, useState } from 'react';
import { ros2Api } from '../ros2_apis/ros2Api';
import type { FocusState, GraphEntry, GraphFocusEntry, GraphKind, GraphListResult, SchemaResult } from '../ros2_apis/bridge_types';
import { EMPTY_FOCUS, sameEntry, isGraphFocus } from '../ros2_apis/focusUtils';
import { PlusIcon, TrashIcon } from './icons';
import './InterfaceBrowser.css';
import './GraphBrowser.css';

const TABS: { kind: GraphKind; label: string }[] = [
  { kind: 'topic',   label: 'Topics' },
  { kind: 'service', label: 'Services' },
  { kind: 'action',  label: 'Actions' },
];

function entriesFor(list: GraphListResult | null, kind: GraphKind): GraphEntry[] {
  if (!list) { return []; }
  return kind === 'topic' ? list.topics : kind === 'service' ? list.services : list.actions;
}

// Type strings look like "geometry_msgs/msg/Twist" / ".../srv/AddTwoInts" / ".../action/Fibonacci".
function parseType(type: string): { pkg: string; name: string } | null {
  const parts = type.split('/');
  if (parts.length !== 3) { return null; }
  return { pkg: parts[0], name: parts[2] };
}

function fetchSchema(kind: GraphKind, type: string): Promise<SchemaResult> {
  const parsed = parseType(type);
  if (!parsed) { return Promise.reject(new Error(`Could not parse type "${type}"`)); }
  if (kind === 'topic')   { return ros2Api.getMsgSchema(parsed.pkg, parsed.name); }
  if (kind === 'service') { return ros2Api.getSrvSchema(parsed.pkg, parsed.name); }
  return ros2Api.getActionSchema(parsed.pkg, parsed.name);
}

export default function GraphBrowser() {
  const [list, setList] = useState<GraphListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<GraphKind>('topic');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GraphEntry | null>(null);
  const [schema, setSchema] = useState<SchemaResult | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [focus, setFocus] = useState<FocusState>(EMPTY_FOCUS);

  function fetchGraph() {
    return ros2Api.listGraph()
      .then(result => { setList(result); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  // Event-handler version (button click): resets loading/error synchronously
  // before kicking off the fetch, since it's not running inside an effect.
  function refresh() {
    setLoading(true);
    setLoadError(null);
    void fetchGraph();
  }

  useEffect(() => {
    void fetchGraph();
    ros2Api.listFocus().then(setFocus).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const entries = entriesFor(list, kind);
    const q = query.trim().toLowerCase();
    if (!q) { return entries; }
    return entries.filter(e => e.name.toLowerCase().includes(q));
  }, [list, kind, query]);

  function selectTab(next: GraphKind) {
    setKind(next);
    setSelected(null);
    setSchema(null);
    setSchemaError(null);
  }

  function preview(entry: GraphEntry) {
    setSelected(entry);
    setSchema(null);
    setSchemaError(null);
    setSchemaLoading(false);
    setShowJson(false);
  }

  function toggleFocus(entry: GraphEntry, isPinned: boolean) {
    const focusEntry: GraphFocusEntry = { source: 'graph', kind, name: entry.name, types: entry.types };
    const request = isPinned ? ros2Api.removeFocus(focusEntry) : ros2Api.addFocus(focusEntry);
    request.then(setFocus).catch(() => {});
  }

  function selectFocusEntry(entry: GraphFocusEntry) {
    ros2Api.setActiveFocus(entry).then(setFocus).catch(() => {});
    setKind(entry.kind);
    preview({ name: entry.name, types: entry.types });
  }

  function removeFocusEntry(entry: GraphFocusEntry) {
    ros2Api.removeFocus(entry).then(setFocus).catch(() => {});
  }

  function toggleSchema() {
    if (schema) {
      setShowJson(v => !v);
      return;
    }
    if (!selected || selected.types.length === 0) { return; }
    setSchemaLoading(true);
    setSchemaError(null);
    fetchSchema(kind, selected.types[0])
      .then(result => {
        setSchema(result);
        setShowJson(true);
      })
      .catch(err => setSchemaError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSchemaLoading(false));
  }

  const graphFocusItems = focus.items.filter(isGraphFocus);

  return (
    <div className="interface-browser">
      {graphFocusItems.length > 0 && (
        <div className="focus-list">
          {graphFocusItems.map(entry => {
            const id = `${entry.kind}:${entry.name}`;
            const isActive = focus.active !== null && sameEntry(focus.active, entry);
            return (
              <div key={id} className={`focus-chip ${isActive ? 'active' : ''}`}>
                <button className="focus-chip-label" onClick={() => selectFocusEntry(entry)} title="Set as focused for Claude">
                  <span className="focus-chip-kind">{entry.kind}</span>
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

      <div className="graph-toolbar">
        <input
          className="interface-search graph-search"
          type="text"
          placeholder={`Search ${TABS.find(t => t.kind === kind)!.label.toLowerCase()}…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="graph-refresh" onClick={refresh} disabled={loading} title="Re-scan the live ROS2 graph">
          {loading ? '…' : '⟳'}
        </button>
      </div>

      {loadError && <p className="hint interface-error">Failed to list the ROS2 graph: {loadError}</p>}

      <div className="interface-body">
        <ul className="interface-list">
          {list === null && !loadError && <li className="interface-empty">Loading…</li>}
          {list !== null && filtered.length === 0 && (
            <li className="interface-empty">No matches</li>
          )}
          {filtered.map(entry => {
            const isSelected = selected?.name === entry.name;
            const isPinned = graphFocusItems.some(i => i.kind === kind && i.name === entry.name);
            return (
              <li key={entry.name} className="interface-row">
                <button
                  className={`interface-item graph-item ${isSelected ? 'active' : ''}`}
                  onClick={() => preview(entry)}
                >
                  <span className="graph-name">{entry.name}</span>
                  <span className="graph-types">{entry.types.join(', ') || '—'}</span>
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
              <span>{selected.name}</span>
              {selected.types.length > 0 && (
                <button className="json-toggle" onClick={toggleSchema} disabled={schemaLoading}>
                  {schemaLoading ? 'Loading…' : showJson ? 'Hide JSON' : 'Show JSON'}
                </button>
              )}
            </div>
            <p className="graph-detail-types">{selected.types.join(', ') || 'No type reported'}</p>
            {schemaError && <p className="hint interface-error">{schemaError}</p>}
            {schema && showJson && <pre className="interface-schema">{JSON.stringify(schema, null, 2)}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
