import * as vscode from 'vscode';
import * as path from 'path';
import { generateScaffold, isScaffoldManagedHtml, layoutUriForScaffoldHtml, type VendorAssets } from './scaffoldGen';
import { parseLayoutDocumentText } from './layoutTypes';

// Matches src="..."/href="..." that point at a local relative asset (not a URL, data URI, anchor, etc.).
const ASSET_ATTR_RE = /\b(src|href)=(["'])(?!https?:|\/\/|data:|#|vscode-webview:)([^"']+)\2/g;

const ZOOM_ROOT_ID = '__ros2_preview_zoom_root';

// No visible UI at all: measures the content's natural (unscaled) size and picks whatever CSS
// "zoom" factor makes it fit the actual webview viewport, recomputing on resize. "zoom" (not
// "transform: scale") is used because it doesn't create a new containing block for
// position:fixed descendants the way transform does, so a generated page's own fixed-position
// UI (e.g. a connection-status badge) stays correctly pinned to the real viewport instead of
// scaling/moving with the content.
const AUTO_FIT_SCRIPT_HTML = `
<script>
(function () {
  var root = document.getElementById('${ZOOM_ROOT_ID}');
  var MIN_SCALE = 0.05, MAX_SCALE = 10;

  function fit() {
    root.style.zoom = 1; // reset first so scrollWidth/Height reflect the true unscaled size
    var w = root.scrollWidth;
    var h = root.scrollHeight;
    if (!w || !h) { return; }
    var scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    root.style.zoom = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  }

  fit();
  window.addEventListener('resize', fit);
})();
</script>`;

// Wraps the loaded page's body content in a zoomable root and auto-fits it to the webview
// viewport — no manual controls, so there's nothing to look cluttered or overlap the content.
// No-ops if the file has no <body>/</body> to wrap.
function injectAutoFit(html: string): string {
  if (!/<body[^>]*>/i.test(html) || !/<\/body>/i.test(html)) { return html; }
  html = html.replace(/<body([^>]*)>/i, (match) => `${match}\n<div id="${ZOOM_ROOT_ID}" style="zoom:1;">`);
  html = html.replace(/<\/body>/i, `</div>\n${AUTO_FIT_SCRIPT_HTML}\n</body>`);
  return html;
}

// A batch of file writes (e.g. Claude editing panel.html/style.css/script.js together) fires
// several FileSystemWatcher events in quick succession. Debouncing coalesces them into one
// render after things settle, instead of the delay below.
const RELOAD_DEBOUNCE_MS = 300;

export class PreviewPanelManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private watchers = new Map<string, vscode.FileSystemWatcher>();
  private reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Chains renders for a given panel one after another so two overlapping reload events can
  // never run maybeRegenerateScaffold/readFile concurrently — a render started while another is
  // still writing <name>.html could read a half-written file and show a broken/black page.
  private renderChains = new Map<string, Promise<void>>();

  constructor(
    private readonly getRosbridgeUrl: () => string,
    private readonly vendorAssets: VendorAssets,
  ) {}

  async open(htmlUri: vscode.Uri): Promise<void> {
    const key = htmlUri.toString();
    let panel = this.panels.get(key);

    if (!panel) {
      const dir = vscode.Uri.file(path.dirname(htmlUri.fsPath));
      panel = vscode.window.createWebviewPanel(
        'ros2GuiPreview',
        `Preview: ${path.basename(htmlUri.fsPath)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dir] },
      );
      this.panels.set(key, panel);

      // Ignore changes to htmlUri itself, and to vendored assets (e.g. tailwind.min.css, the
      // tailwind-build/ recipe folder) that render() below (via generateScaffold) writes once
      // on first use — same reasoning as htmlUri: these are build-artifact writes triggered BY
      // a render, not user edits, so reacting to them would just fire an extra redundant render
      // (or, when several vendor files are created in the same burst as other first-time setup,
      // add unnecessary extra churn on top of the debounce below). Every other change in the
      // directory (panel.html/style.css/script.js, or the .ros2ui.json layout itself) still
      // triggers a fresh render.
      const reload = (changedUri: vscode.Uri) => {
        if (changedUri.fsPath === htmlUri.fsPath) { return; }
        if (this.isVendorAssetPath(changedUri)) { return; }
        const existing = this.reloadTimers.get(key);
        if (existing) { clearTimeout(existing); }
        this.reloadTimers.set(key, setTimeout(() => {
          this.reloadTimers.delete(key);
          // render() already surfaces failures itself (notification + error page); this catch
          // just prevents an unhandled-rejection warning for this fire-and-forget call.
          this.queueRender(key, panel!, htmlUri).catch(() => {});
        }, RELOAD_DEBOUNCE_MS));
      };
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '**/*'));
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      this.watchers.set(key, watcher);

      panel.onDidDispose(() => {
        this.panels.delete(key);
        this.watchers.get(key)?.dispose();
        this.watchers.delete(key);
        const timer = this.reloadTimers.get(key);
        if (timer) { clearTimeout(timer); }
        this.reloadTimers.delete(key);
        this.renderChains.delete(key);
      });
    } else {
      panel.reveal(vscode.ViewColumn.Beside);
    }

    await this.queueRender(key, panel, htmlUri);
  }

  // True if changedUri is (or lives inside) one of the vendored asset paths — e.g.
  // "tailwind.min.css" or "tailwind-build/README.md" — identified by matching either the
  // changed file's own name or its immediate parent directory's name against the top-level
  // segment of a vendorAssets key. Good enough without knowing the exact panelsDirUri here:
  // panel ids are UUIDs, so collisions with vendor names like "tailwind-build" don't happen.
  private isVendorAssetPath(changedUri: vscode.Uri): boolean {
    const names = new Set(Object.keys(this.vendorAssets).map(p => p.split('/')[0]));
    const segments = changedUri.fsPath.split(path.sep);
    return names.has(segments[segments.length - 1]) || names.has(segments[segments.length - 2]);
  }

  // Appends a render to the per-panel chain so renders for the same panel never overlap.
  // The chain itself (`renderChains`) must never become a rejected promise — otherwise every
  // later .then() on it would be skipped forever, silently stopping all future reloads for this
  // panel — so scheduling always continues off a settled copy. The promise returned to the
  // *caller*, though, still rejects on failure so an explicit open() (and therefore the MCP
  // /preview call) can report the real error instead of a silent success.
  private queueRender(key: string, panel: vscode.WebviewPanel, htmlUri: vscode.Uri): Promise<void> {
    const prior = (this.renderChains.get(key) ?? Promise.resolve()).catch(() => {});
    const result = prior.then(() => this.render(panel, htmlUri));
    this.renderChains.set(key, result.catch(() => {}));
    return result;
  }

  // If htmlUri is a scaffold-managed file (carries the ROS2-WEBVIEW-SCAFFOLD marker) with a
  // sibling .ros2ui.json still on disk, regenerate it from the layout + current panel.html/
  // style.css/script.js contents before every render — so editing a panel file and previewing
  // (or leaving preview open) can never show a stale <template> snapshot; there's no separate
  // "remember to regenerate" step to forget.
  private async maybeRegenerateScaffold(htmlUri: vscode.Uri): Promise<void> {
    if (!(await isScaffoldManagedHtml(htmlUri))) { return; }
    const layoutUri = layoutUriForScaffoldHtml(htmlUri);
    let layoutBytes: Uint8Array;
    try {
      layoutBytes = await vscode.workspace.fs.readFile(layoutUri);
    } catch {
      return; // no sibling layout file (e.g. renamed/deleted) — show whatever's on disk as-is
    }
    try {
      const doc = parseLayoutDocumentText(Buffer.from(layoutBytes).toString('utf8'));
      await generateScaffold(doc, layoutUri, this.getRosbridgeUrl(), this.vendorAssets);
    } catch (err) {
      console.error('ROS2 webview: failed to auto-regenerate GUI scaffold before preview:', err);
    }
  }

  private async render(panel: vscode.WebviewPanel, htmlUri: vscode.Uri): Promise<void> {
    try {
      await this.renderUnsafe(panel, htmlUri);
    } catch (err) {
      // A failure here (most commonly: htmlUri doesn't exist yet because "ROS2 Webview:
      // Generate GUI Scaffold" was never run for this layout) used to leave the webview
      // panel exactly as vscode.window.createWebviewPanel() created it: no html set at all,
      // i.e. a plain blank/black panel with zero indication anything went wrong. Put the
      // error on screen and in a notification instead of failing silently.
      const isMissing = err instanceof vscode.FileSystemError && err.code === 'FileNotFound';
      const message = isMissing
        ? `File not found: ${htmlUri.fsPath}\n\nRun "ROS2 Webview: Generate GUI Scaffold" on the .ros2ui.json layout first.`
        : err instanceof Error ? err.message : String(err);
      panel.webview.html = this.errorHtml(message);
      vscode.window.showErrorMessage(`ROS2 Webview preview failed: ${message.split('\n')[0]}`);
      throw err;
    }
  }

  private errorHtml(message: string): string {
    const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><body style="background:#1e1e1e;color:#f14c4c;font-family:sans-serif;
      white-space:pre-wrap;padding:16px;">${escaped}</body></html>`;
  }

  private async renderUnsafe(panel: vscode.WebviewPanel, htmlUri: vscode.Uri): Promise<void> {
    await this.maybeRegenerateScaffold(htmlUri);

    const dir = vscode.Uri.file(path.dirname(htmlUri.fsPath));
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    let html = Buffer.from(bytes).toString('utf8');

    html = html.replace(ASSET_ATTR_RE, (_match: string, attr: string, quote: string, relPath: string) => {
      const assetUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(dir, relPath));
      return `${attr}=${quote}${assetUri.toString()}${quote}`;
    });

    // Content is locally authored (by the user or Claude), so the CSP here just scopes
    // script/style/connect sources to this one panel rather than trying to sandbox untrusted content.
    //
    // No frame-src: an earlier design that composed a generated GUI's panels via one
    // <iframe> per panel was dropped after repeated CSP failures, since a cross-document
    // iframe navigation to a local file gets its own pseudo-origin in a VS Code webview
    // that doesn't treat sibling resources as same-origin the way a normal web server would.
    const csp = [
      `default-src 'none'`,
      `img-src ${panel.webview.cspSource} https: data:`,
      `style-src ${panel.webview.cspSource} 'unsafe-inline' https:`,
      `font-src ${panel.webview.cspSource} https:`,
      `script-src ${panel.webview.cspSource} 'unsafe-inline' https:`,
      `connect-src * ws: wss:`,
    ].join('; ');
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, match => `${match}\n${cspTag}`)
      : `${cspTag}\n${html}`;

    html = injectAutoFit(html);

    panel.webview.html = html;
  }
}
