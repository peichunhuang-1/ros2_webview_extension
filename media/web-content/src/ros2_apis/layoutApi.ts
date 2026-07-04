import { VSCode } from './bridge';
import {
  VSCodePostTypeDefine,
  type LayoutDocument,
  type LayoutInitPayload,
  type UploadImageRequest,
  type UploadImageResult,
} from './bridge_types';

export const layoutApi = {
  // Fire-and-forget: tells the provider the webview is mounted and ready for `layout/init`.
  ready(): void {
    VSCode.postMessage({ type: VSCodePostTypeDefine.LAYOUT_READY });
  },

  // Fire-and-forget: pushed to the provider, which applies it as a text-document edit.
  update(doc: LayoutDocument): void {
    VSCode.postMessage({ type: VSCodePostTypeDefine.LAYOUT_UPDATE, payload: doc });
  },

  uploadImage(dataUri: string, suggestedName: string): Promise<UploadImageResult> {
    return VSCode.request<UploadImageResult>(
      VSCodePostTypeDefine.LAYOUT_UPLOAD_IMAGE,
      { dataUri, suggestedName } satisfies UploadImageRequest,
    );
  },

  // Subscribes to provider-pushed `layout/init` messages (initial load + external edits/undo).
  onInit(callback: (payload: LayoutInitPayload) => void): () => void {
    return VSCode.onMessage((msg) => {
      const m = msg as { type?: string; payload?: LayoutInitPayload };
      if (m.type === VSCodePostTypeDefine.LAYOUT_INIT && m.payload) {
        callback(m.payload);
      }
    });
  },
};
