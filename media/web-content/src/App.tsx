import { useState } from 'react';
import './App.css';
import { ros2Api } from './ros2_apis/ros2Api';
import type { ConnectionStatus } from './ros2_apis/bridge_types';
import InterfaceBrowser from './components/InterfaceBrowser';
import GraphBrowser from './components/GraphBrowser';

type ConnectState = 'idle' | 'connecting' | ConnectionStatus;
type View = 'interfaces' | 'graph';

function statusLabel(s: ConnectState): string {
  switch (s) {
    case 'idle':         return 'Not connected';
    case 'connecting':   return 'Connecting…';
    case 'connected':    return 'Connected';
    case 'unavailable':  return 'ROS2 not found';
    case 'disconnected': return 'Disconnected';
  }
}

function statusColor(s: ConnectState): string {
  switch (s) {
    case 'connected':   return 'var(--vscode-testing-iconPassed, #4caf50)';
    case 'unavailable': return 'var(--vscode-testing-iconFailed, #f44336)';
    default:            return 'var(--vscode-descriptionForeground)';
  }
}

export default function App() {
  const [connectState, setConnectState] = useState<ConnectState>('idle');
  const [distro, setDistro] = useState<string | null>(null);
  const [view, setView] = useState<View>('interfaces');

  async function handleConnect() {
    if (connectState === 'connected') {
      await ros2Api.disconnect();
      setConnectState('disconnected');
      setDistro(null);
      return;
    }

    setConnectState('connecting');
    try {
      const result = await ros2Api.connect();
      setConnectState(result.status);
      setDistro(result.distro);
    } catch {
      setConnectState('unavailable');
    }
  }

  const isConnected = connectState === 'connected';
  const isBusy      = connectState === 'connecting';

  return (
    <div className="app">
      <header className="toolbar">
        <span className="title">ROS2 Webview</span>
        <button
          className={`connect-btn ${isConnected ? 'connected' : ''}`}
          onClick={handleConnect}
          disabled={isBusy}
        >
          {isBusy ? 'Connecting…' : isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </header>

      <div className="status-bar">
        <span
          className="status-dot"
          style={{ background: statusColor(connectState) }}
        />
        <span className="status-text" style={{ color: statusColor(connectState) }}>
          {statusLabel(connectState)}
          {distro ? ` · ROS2 ${distro}` : ''}
        </span>
      </div>

      <main className="content">
        {!isConnected && (
          <p className="hint">
            Press <strong>Connect</strong> to detect the ROS2 environment and enable schema lookup.
          </p>
        )}
        {isConnected && (
          <>
            <div className="view-tabs">
              <button
                className={`view-tab ${view === 'interfaces' ? 'active' : ''}`}
                onClick={() => setView('interfaces')}
              >
                Interfaces
              </button>
              <button
                className={`view-tab ${view === 'graph' ? 'active' : ''}`}
                onClick={() => setView('graph')}
              >
                Live Graph
              </button>
            </div>
            {view === 'interfaces' ? <InterfaceBrowser /> : <GraphBrowser />}
          </>
        )}
      </main>
    </div>
  );
}
