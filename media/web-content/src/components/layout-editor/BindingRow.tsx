import type {
  FocusEntry, GraphKind, GraphListResult, InterfaceKind, InterfaceListResult,
} from '../../ros2_apis/bridge_types';
import SearchableSelect from './SearchableSelect';
import { TrashIcon } from '../icons';

// One binding editor row: source (installed interface vs. live graph entry),
// kind, and a searchable picker over the matching entries.
export default function BindingRow({ binding, interfaces, graph, onChange, onRemove }: {
  binding: FocusEntry;
  interfaces: InterfaceListResult | null;
  graph: GraphListResult | null;
  onChange: (next: FocusEntry) => void;
  onRemove: () => void;
}) {
  function setSource(source: 'interface' | 'graph') {
    onChange(source === 'interface'
      ? { source: 'interface', kind: 'msg', pkg: '', name: '' }
      : { source: 'graph', kind: 'topic', name: '', types: [] });
  }
  function setInterfaceKind(kind: InterfaceKind) {
    onChange({ source: 'interface', kind, pkg: '', name: '' });
  }
  function setGraphKind(kind: GraphKind) {
    onChange({ source: 'graph', kind, name: '', types: [] });
  }

  const interfaceEntries = interfaces && binding.source === 'interface'
    ? (binding.kind === 'msg' ? interfaces.msgs : binding.kind === 'srv' ? interfaces.srvs : interfaces.actions)
    : [];
  const graphEntries = graph && binding.source === 'graph'
    ? (binding.kind === 'topic' ? graph.topics : binding.kind === 'service' ? graph.services : graph.actions)
    : [];

  return (
    <div className="layout-binding-row">
      <select value={binding.source} onChange={e => setSource(e.target.value as 'interface' | 'graph')}>
        <option value="interface">Interface definition</option>
        <option value="graph">Live graph entry</option>
      </select>

      {binding.source === 'interface' ? (
        <>
          <select value={binding.kind} onChange={e => setInterfaceKind(e.target.value as InterfaceKind)}>
            <option value="msg">msg</option>
            <option value="srv">srv</option>
            <option value="action">action</option>
          </select>
          <SearchableSelect
            value={binding.pkg && binding.name ? `${binding.pkg}/${binding.name}` : ''}
            placeholder="Search interfaces…"
            options={interfaceEntries.map(entry => ({ value: `${entry.pkg}/${entry.name}`, label: `${entry.pkg}/${entry.name}` }))}
            onChange={value => {
              const [pkg, name] = value.split('/');
              onChange({ ...binding, pkg, name });
            }}
          />
        </>
      ) : (
        <>
          <select value={binding.kind} onChange={e => setGraphKind(e.target.value as GraphKind)}>
            <option value="topic">topic</option>
            <option value="service">service</option>
            <option value="action">action</option>
          </select>
          <SearchableSelect
            value={binding.name}
            placeholder="Search live graph…"
            options={graphEntries.map(entry => ({ value: entry.name, label: entry.name }))}
            onChange={name => {
              const entry = graphEntries.find(g => g.name === name);
              onChange({ ...binding, name, types: entry?.types ?? [] });
            }}
          />
        </>
      )}

      <button type="button" className="layout-image-remove" onClick={onRemove} title="Remove binding">
        <TrashIcon />
      </button>
    </div>
  );
}
