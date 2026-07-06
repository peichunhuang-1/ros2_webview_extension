import * as vscode from 'vscode';
import * as path from 'path';
import type { LayoutDocument, LayoutPanel } from './layoutTypes';

// Same convention as assetsDirFor() in layoutEditorProvider.ts: strip the
// ".ros2ui.json" suffix and derive sibling paths from the base name, so
// "dashboard.ros2ui.json" -> "dashboard.html" + "dashboard.panels/".
export interface ScaffoldPaths {
  htmlUri: vscode.Uri;
  panelsDirUri: vscode.Uri;
}

export function scaffoldPathsFor(layoutUri: vscode.Uri): ScaffoldPaths {
  const dir = path.dirname(layoutUri.fsPath);
  const base = path.basename(layoutUri.fsPath).replace(/\.ros2ui\.json$/, '');
  return {
    htmlUri: vscode.Uri.file(path.join(dir, `${base}.html`)),
    panelsDirUri: vscode.Uri.file(path.join(dir, `${base}.panels`)),
  };
}

// Inverse of scaffoldPathsFor()'s htmlUri: "dashboard.html" -> "dashboard.ros2ui.json".
export function layoutUriForScaffoldHtml(htmlUri: vscode.Uri): vscode.Uri {
  const dir = path.dirname(htmlUri.fsPath);
  const base = path.basename(htmlUri.fsPath).replace(/\.html$/, '');
  return vscode.Uri.file(path.join(dir, `${base}.ros2ui.json`));
}

// Version-tolerant so a future v2 scaffold format still recognizes v1 output
// as "ours" and safely overwrites it without re-prompting the user.
const SCAFFOLD_MARKER_RE = /ROS2-WEBVIEW-SCAFFOLD:v(\d+)/;
const CURRENT_SCAFFOLD_VERSION = 1;

// Used to guard against clobbering a pre-existing, unrelated <name>.html that
// predates this feature (e.g. a hand-authored file) — if it has no marker,
// the caller should confirm with the user before overwriting.
export async function isForeignExistingHtml(htmlUri: vscode.Uri): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    return !SCAFFOLD_MARKER_RE.test(Buffer.from(bytes).toString('utf8'));
  } catch {
    return false; // doesn't exist yet — nothing foreign to guard against
  }
}

// Unlike isForeignExistingHtml (which treats "doesn't exist" as "not foreign"), this is only
// true when htmlUri exists AND carries the marker — used to decide whether it's safe to
// auto-regenerate a file before previewing it.
export async function isScaffoldManagedHtml(htmlUri: vscode.Uri): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    return SCAFFOLD_MARKER_RE.test(Buffer.from(bytes).toString('utf8'));
  } catch {
    return false;
  }
}

export interface ScaffoldResult {
  htmlUri: vscode.Uri;
  createdPanelIds: string[];
  orphanedPanelDirs: string[];
}

function validatePanelId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`Panel id "${id}" contains characters unsafe for a folder/DOM-id name (only a-z, A-Z, 0-9, "-", "_" allowed).`);
  }
}

function assertUniquePanelIds(panels: LayoutPanel[]): void {
  const seen = new Set<string>();
  for (const p of panels) {
    if (seen.has(p.id)) { throw new Error(`Duplicate panel id "${p.id}" in layout — every panel.id must be unique.`); }
    seen.add(p.id);
  }
}

function escapeHtmlComment(s: string): string {
  return s.replace(/-->/g, '--\\>');
}

function stubPanelHtml(panel: LayoutPanel): string {
  const notes = panel.notes?.trim() || '(none)';
  return `<!--
  ROS2 Webview scaffold panel: "${escapeHtmlComment(panel.label)}" (id: ${panel.id})
  This is a CONTENT FRAGMENT, not a full document — no <html>/<head>/<body> here.
  It is spliced verbatim into a <template> inside the generated <name>.html every time
  "ROS2 Webview: Generate GUI Scaffold" runs. That file itself is never hand-edited.

  Geometry (position, size, stacking order) for this panel is fixed by the .ros2ui.json layout
  and rendered by the generator — never position/size/float anything in here; write markup that
  simply fills its container (100% width/height, inherited from the host div).

  Notes from the layout: ${escapeHtmlComment(notes)}
-->
<div class="panel-content">
  <!-- TODO: replace with the real UI for "${escapeHtmlComment(panel.label)}" -->
</div>
`;
}

function stubPanelCss(panel: LayoutPanel): string {
  return `/*
  Styles for panel "${panel.label}" (id: ${panel.id}).
  This stylesheet is loaded inside THIS PANEL'S OWN Shadow DOM only — it can never leak to, or be
  affected by, any other panel's CSS. No class-name prefixing/namespacing is needed to avoid
  collisions with other panels. Rules outside this file (the main scaffold, other panels) never
  apply here either — only ":host" and rules written in this file do.

  Uses the shared design tokens (var(--rw-*), from the sibling design-tokens.css linked once in
  <head>) so a fresh panel already matches the dashboard's light/dark theme instead of a
  hardcoded color. Keep any "not loaded yet" / placeholder state a light neutral like below, not a
  near-black background — a panel that legitimately has no data yet (e.g. an image viewer before
  the first frame arrives) should still read as "empty," not as broken or as a solid black hole
  dominating the layout, especially since panels can take up a large fraction of a small canvas.
*/
:host { display: block; width: 100%; height: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.panel-content { width: 100%; height: 100%; background: var(--rw-panel-bg, #f3f4f6); color: var(--rw-shell-text, #1f2937); }
`;
}

function stubPanelJs(panel: LayoutPanel): string {
  return `/*
  Script for panel "${panel.label}" (id: ${panel.id}). Loaded as a plain classic <script> — no
  import/export.

  Put ALL your logic (state, event listeners, ROS subscriptions) inside the function body below;
  it is called exactly once, after this file has loaded. Shadow DOM isolates this panel's CSS/DOM
  from every other panel, but NOT the JS global scope — the one way panels can still collide is if
  this script reads/writes window.* globals or queries document.* directly instead of shadowRoot.
  Don't do either; everything you need arrives as an argument below.

  Arguments:
    shadowRoot — this panel's shadow root; query/build DOM inside it, e.g.
                 shadowRoot.querySelector('.panel-content')
    ros        — one ROSLIB.Ros instance shared by every panel (already open/opening)
    bindings   — this panel's bindings array from the .ros2ui.json layout, each entry either
                 { source:'interface', kind:'msg'|'srv'|'action', pkg, name } or
                 { source:'graph', kind:'topic'|'service'|'action', name, types }
                 (call get_ros2_msg_schema/get_ros2_srv_schema/get_ros2_action_schema via MCP for
                 field-level schema — this array only has topic/type names.)
*/
window[${JSON.stringify(mountFnName(panel.id))}] = function (shadowRoot, ros, bindings) {
  var root = shadowRoot.querySelector('.panel-content');
  // TODO: subscribe/call services via \`ros\` + \`bindings\`, render into \`root\`.
};
`;
}

function mountFnName(panelId: string): string {
  return `mountPanel_${panelId}`;
}

// Guards against a topic/type/label/notes string containing "</script>" breaking out of an
// inline <script> block.
function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function panelStyleAttr(panel: LayoutPanel): string {
  const layer = panel.layer ?? 0;
  return `position:absolute;left:${panel.x}px;top:${panel.y}px;width:${panel.width}px;height:${panel.height}px;z-index:${layer};`;
}

function buildDashboardHtml(doc: LayoutDocument, fragments: Map<string, string>, rosbridgeUrl: string, baseName: string): string {
  const layoutData = {
    rosbridgeUrl,
    panels: Object.fromEntries(doc.panels.map(p => [p.id, { label: p.label, notes: p.notes ?? '', bindings: p.bindings }])),
  };

  const stageDivs = doc.panels
    .map(p => `    <div class="ros2-panel" id="panel-${p.id}" style="${panelStyleAttr(p)}"></div>`)
    .join('\n');

  const templates = doc.panels
    .map(p => {
      const notes = escapeHtmlComment(p.notes?.trim() || '(none)');
      const fragment = fragments.get(p.id) ?? '';
      return `<template id="tpl-${p.id}">
<!-- notes (from ${baseName}.ros2ui.json, refreshed on every regeneration): ${notes} -->
<!-- Tailwind utility classes (a curated subset; see ${baseName}.panels/tailwind-build/README.md
     for the full list/how to extend it) are available in panel.html/style.css. -->
<link rel="stylesheet" href="${baseName}.panels/tailwind.min.css">
<link rel="stylesheet" href="${baseName}.panels/${p.id}/style.css">
${fragment}
<script src="${baseName}.panels/${p.id}/script.js"></script>
</template>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- ROS2-WEBVIEW-SCAFFOLD:v${CURRENT_SCAFFOLD_VERSION} — generated by "ROS2 Webview: Generate GUI Scaffold"
     from ${baseName}.ros2ui.json. DO NOT HAND-EDIT: this file is fully overwritten on every
     regeneration. Panel content lives in ${baseName}.panels/<panelId>/{panel.html,style.css,script.js}
     — edit those instead. -->
<!-- Shared design tokens (--rw-* custom properties + shell background/margin reset). Linked
     once here, not per panel like tailwind.min.css below — CSS custom properties inherit
     through Shadow DOM boundaries even though class-based rules don't, so every panel's own
     style.css can reference var(--rw-*) without re-linking this file. See
     ${baseName}.panels/design-tokens.css for the full token list and rationale. -->
<link rel="stylesheet" href="${baseName}.panels/design-tokens.css">
<script src="https://cdn.jsdelivr.net/npm/roslib@1/build/roslib.min.js"></script>
</head>
<body>
<div id="ros2-stage" style="position:relative;width:${doc.canvas.width}px;height:${doc.canvas.height}px;">
${stageDivs}
</div>

<div id="ros2-conn-status" style="position:fixed;bottom:8px;right:8px;padding:4px 10px;
     font:12px sans-serif;border-radius:4px;color:#fff;background:#555;z-index:2147483647;">
  Connecting to rosbridge…
</div>

<script>
window.ROS2_LAYOUT = ${jsonForInlineScript(layoutData)};
</script>

${templates}

<script>
(function () {
  var ids = Object.keys(window.ROS2_LAYOUT.panels);
  var shadowRoots = {};
  ids.forEach(function (id) {
    var host = document.getElementById('panel-' + id);
    var shadow = host.attachShadow({ mode: 'open' });
    var tpl = document.getElementById('tpl-' + id);
    shadow.appendChild(document.importNode(tpl.content, true));
    shadowRoots[id] = shadow;
  });

  function whenScriptLoaded(id) {
    return new Promise(function (resolve) {
      var script = shadowRoots[id].querySelector('script[src]');
      if (!script) { resolve(); return; }
      script.addEventListener('load', function () { resolve(); }, { once: true });
      script.addEventListener('error', function () {
        console.error('ROS2 GUI: panel "' + id + '" script failed to load.');
        resolve(); // don't block every other panel over one bad panel
      }, { once: true });
    });
  }

  Promise.all(ids.map(whenScriptLoaded)).then(function () {
    var statusEl = document.getElementById('ros2-conn-status');

    // roslib.min.js is loaded from a CDN in <head>; if that request ever fails or is slow
    // (network hiccup), ROSLIB stays undefined and "new ROSLIB.Ros(...)" below would throw
    // before any panel gets mounted, silently leaving the whole page blank with no on-screen
    // sign of why. Surface it instead of failing silently.
    if (typeof ROSLIB === 'undefined') {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Failed to load roslib.js from CDN (check network/internet access) — panels cannot mount.';
      statusEl.style.background = '#c0392b';
      console.error('ROS2 GUI: window.ROSLIB is undefined — roslib.min.js failed to load from the CDN.');
      return;
    }

    var ros;
    try {
      ros = new ROSLIB.Ros({ url: window.ROS2_LAYOUT.rosbridgeUrl });
    } catch (err) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Failed to initialize ROSLIB.Ros: ' + (err && err.message ? err.message : err);
      statusEl.style.background = '#c0392b';
      console.error('ROS2 GUI: failed to construct ROSLIB.Ros:', err);
      return;
    }
    ros.on('connection', function () {
      statusEl.textContent = 'rosbridge connected (' + window.ROS2_LAYOUT.rosbridgeUrl + ')';
      statusEl.style.background = '#2a7d4f';
      setTimeout(function () { statusEl.style.display = 'none'; }, 4000);
    });
    ros.on('error', function () {
      statusEl.style.display = 'block';
      statusEl.textContent = 'rosbridge connection error (' + window.ROS2_LAYOUT.rosbridgeUrl +
        ') — is rosbridge_server running?';
      statusEl.style.background = '#c0392b';
    });
    ros.on('close', function () {
      statusEl.style.display = 'block';
      statusEl.textContent = 'rosbridge disconnected (' + window.ROS2_LAYOUT.rosbridgeUrl + ')';
      statusEl.style.background = '#c0392b';
    });
    ids.forEach(function (id) {
      var mount = window['mountPanel_' + id];
      if (typeof mount !== 'function') {
        console.warn('ROS2 GUI: panel "' + id + '" did not define window[\\'mountPanel_' + id + '\\'].');
        return;
      }
      try { mount(shadowRoots[id], ros, window.ROS2_LAYOUT.panels[id].bindings); }
      catch (err) { console.error('ROS2 GUI: panel "' + id + '" mount failed:', err); }
    });
  });
})();
</script>
</body>
</html>
`;
}

// Relative path (under the generated <name>.panels/ dir) -> file content, for vendored assets
// (currently: Tailwind CSS + its regeneration recipe) copied into a user's own project. Copied
// rather than referenced from inside the extension install dir so the generated GUI stays a
// self-contained, portable artifact that works outside VS Code too (opened directly in a
// browser, deployed elsewhere, etc.) — same reasoning as why panel.html/style.css/script.js
// live in the user's own workspace instead of being loaded from the extension bundle.
export type VendorAssets = Record<string, string>;

async function writeVendorAssetsIfMissing(panelsDirUri: vscode.Uri, vendorAssets: VendorAssets): Promise<void> {
  for (const [relPath, content] of Object.entries(vendorAssets)) {
    const uri = vscode.Uri.joinPath(panelsDirUri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      continue; // already present — never overwrite a user's local copy automatically
    } catch { /* doesn't exist yet — write it below */ }
    const segments = relPath.split('/');
    if (segments.length > 1) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(panelsDirUri, ...segments.slice(0, -1)));
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }
}

export async function generateScaffold(
  doc: LayoutDocument, layoutUri: vscode.Uri, rosbridgeUrl: string, vendorAssets: VendorAssets,
): Promise<ScaffoldResult> {
  assertUniquePanelIds(doc.panels);
  doc.panels.forEach(p => validatePanelId(p.id));

  const { htmlUri, panelsDirUri } = scaffoldPathsFor(layoutUri);
  const baseName = path.basename(htmlUri.fsPath).replace(/\.html$/, '');
  await vscode.workspace.fs.createDirectory(panelsDirUri);
  await writeVendorAssetsIfMissing(panelsDirUri, vendorAssets);

  // Top-level names inside panelsDirUri that are vendored assets (e.g. "tailwind.min.css",
  // "tailwind-build"), not panel folders — excluded below so they're never misreported as an
  // orphaned panel dir just because they aren't a panel id.
  const vendorTopLevelNames = new Set(Object.keys(vendorAssets).map(p => p.split('/')[0]));

  let existingEntries: [string, vscode.FileType][] = [];
  try { existingEntries = await vscode.workspace.fs.readDirectory(panelsDirUri); } catch { /* fresh dir */ }
  const existingDirNames = new Set(
    existingEntries
      .filter(([n, t]) => t === vscode.FileType.Directory && !vendorTopLevelNames.has(n))
      .map(([n]) => n),
  );
  const currentIds = new Set(doc.panels.map(p => p.id));

  const createdPanelIds: string[] = [];
  const fragments = new Map<string, string>();

  for (const panel of doc.panels) {
    const dir = vscode.Uri.joinPath(panelsDirUri, panel.id);
    const panelHtmlUri = vscode.Uri.joinPath(dir, 'panel.html');
    if (!existingDirNames.has(panel.id)) {
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(panelHtmlUri, Buffer.from(stubPanelHtml(panel), 'utf8'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'style.css'), Buffer.from(stubPanelCss(panel), 'utf8'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'script.js'), Buffer.from(stubPanelJs(panel), 'utf8'));
      createdPanelIds.push(panel.id);
    }
    // Re-read even if just created, so `fragments` always reflects on-disk truth
    // (this is what lets dashboard.html stay a safely-regeneratable build artifact).
    const bytes = await vscode.workspace.fs.readFile(panelHtmlUri);
    fragments.set(panel.id, Buffer.from(bytes).toString('utf8'));
  }

  const orphanedPanelDirs = [...existingDirNames].filter(name => !currentIds.has(name));
  if (orphanedPanelDirs.length) {
    console.warn(`ROS2 Webview scaffold: panel folder(s) no longer in the layout, not deleted: ${orphanedPanelDirs.join(', ')}`);
  }

  const html = buildDashboardHtml(doc, fragments, rosbridgeUrl, baseName);
  await vscode.workspace.fs.writeFile(htmlUri, Buffer.from(html, 'utf8'));

  return { htmlUri, createdPanelIds, orphanedPanelDirs };
}
