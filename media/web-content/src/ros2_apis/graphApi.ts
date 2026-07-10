import { VSCode } from './bridge';
import {
  VSCodePostTypeDefine,
  type GraphDocument,
  type GraphInitPayload,
} from './bridge_types';

// Webview <-> host messaging for the node-graph custom editor. Mirrors
// layoutApi.ts: fire-and-forget ready/update plus a subscription to the
// provider's pushed `graph/init` (initial load + external edits/undo).
export const graphApi = {
  ready(): void {
    VSCode.postMessage({ type: VSCodePostTypeDefine.GRAPH_READY });
  },

  update(doc: GraphDocument): void {
    VSCode.postMessage({ type: VSCodePostTypeDefine.GRAPH_UPDATE, payload: doc });
  },

  onInit(callback: (payload: GraphInitPayload) => void): () => void {
    return VSCode.onMessage((msg) => {
      const m = msg as { type?: string; payload?: GraphInitPayload };
      if (m.type === VSCodePostTypeDefine.GRAPH_INIT && m.payload) {
        callback(m.payload);
      }
    });
  },
};
