#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isRos2Available, listInterfaces, readMsgSchema, readSrvSchema, readActionSchema, type JsonSchema } from './schemaGen';
import { listGraph } from './ros2Graph';
import { callBridge } from './bridgeClient';

// Sent to any MCP client during the initialize handshake (per the MCP spec,
// clients MAY surface this to the model as guidance). Unlike CLAUDE.md or a
// project skill, this travels with the server itself rather than living in
// a specific workspace — so it applies no matter which ROS2 project this
// extension is installed into, not just this extension's own source repo.
const SERVER_INSTRUCTIONS = [
  'When the user refers to a previous selection ambiguously ("this topic", "this message", "what I picked", ' +
    'etc.) instead of naming a package/topic explicitly, call get_ros2_focus first rather than asking them to ' +
    'repeat themselves or saying you can\'t tell.',
  'Never hand-author a full-page GUI HTML file from scratch against a .ros2ui.json layout. Call ' +
    'generate_gui_scaffold on the .ros2ui.json file first — it deterministically produces <name>.html (fixed ' +
    'panel geometry, never hand-edited) plus one <name>.panels/<panelId>/{panel.html,style.css,script.js} per ' +
    'panel, plus a shared <name>.panels/tailwind.min.css already linked into every panel\'s Shadow DOM. Only ' +
    'edit the per-panel files: prefer Tailwind utility classes in panel.html for spacing/color/typography/' +
    'layout (it\'s a curated safelist, not the full framework — see <name>.panels/tailwind-build/README.md ' +
    'for what\'s included), fall back to style.css only for what Tailwind\'s safelist doesn\'t cover, and ' +
    'define `window[\'mountPanel_<panelId>\'] = function(shadowRoot, ros, bindings) {...}` in each script.js. ' +
    'Keep any "not loaded yet"/placeholder state a light neutral background (e.g. bg-slate-100), never ' +
    'near-black — a panel legitimately waiting for its first message can be a large fraction of a small ' +
    'canvas, and a dark placeholder there reads as broken rather than empty. A shared ' +
    '<name>.panels/design-tokens.css is also linked once in <name>.html\'s <head> — its --rw-* custom ' +
    'properties (--rw-accent, --rw-success/warning/danger, --rw-panel-bg, --rw-text-muted) are usable in ' +
    'every panel\'s style.css since custom properties inherit through Shadow DOM; reuse --rw-accent for ' +
    'every panel\'s primary/interactive element instead of each panel picking its own color, so the ' +
    'dashboard reads as one system. For genuine visual-design requests beyond these defaults (redesigning ' +
    'a panel, picking a cohesive look from scratch), use the web-design-engineer skill if installed.',
].join('\n\n');

const server = new McpServer({ name: 'ros2-interfaces', version: '0.0.1' }, { instructions: SERVER_INSTRUCTIONS });

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

// Runs a tool body, converting a thrown Error into a normal MCP error result —
// every tool below wants this same behavior instead of a protocol-level failure.
async function runTool(body: () => Promise<unknown> | unknown) {
  try {
    return textResult(await body());
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

// --- Local tools (read the installed ROS2 workspace / live graph directly) ---

server.registerTool(
  'list_ros2_interfaces',
  {
    title: 'List ROS2 interfaces',
    description:
      'List every message (.msg), service (.srv), and action (.action) interface type available in the ' +
      'current ROS2 workspace, discovered via AMENT_PREFIX_PATH. Use this to find the exact package/name ' +
      'pair before requesting a schema.',
  },
  async () => {
    if (!isRos2Available()) {
      return errorResult('ROS2 environment not found: AMENT_PREFIX_PATH is not set or invalid.');
    }
    return textResult(listInterfaces());
  },
);

server.registerTool(
  'list_ros2_graph',
  {
    title: 'List live ROS2 graph (topics, services, actions)',
    description:
      'List the topics, services, and actions that are actually running right now in the live ROS2 graph, ' +
      'each with its interface type (e.g. "geometry_msgs/msg/Twist"). This is different from ' +
      'list_ros2_interfaces, which lists installed interface *definitions* rather than what is currently ' +
      'running. Use this to find the exact topic/service/action names and types to wire up in a generated UI, ' +
      'then split each type string on "/" (package / kind / name) and pass the package and name to ' +
      'get_ros2_msg_schema, get_ros2_srv_schema, or get_ros2_action_schema for the full field schema.',
  },
  () => runTool(() => listGraph()),
);

const schemaInputShape = {
  pkg:  z.string().describe('The ROS2 package name, e.g. "geometry_msgs"'),
  name: z.string().describe('The interface name without extension, e.g. "Twist"'),
};

// The three schema tools are identical apart from the interface kind they read.
const SCHEMA_TOOLS: { name: string; title: string; kind: string; read: (pkg: string, name: string) => Promise<JsonSchema> }[] = [
  { name: 'get_ros2_msg_schema',    title: 'Get ROS2 message schema', kind: 'message (.msg)',                        read: readMsgSchema },
  { name: 'get_ros2_srv_schema',    title: 'Get ROS2 service schema', kind: 'service (.srv) request',                read: readSrvSchema },
  { name: 'get_ros2_action_schema', title: 'Get ROS2 action schema',  kind: 'action (.action) (goal/result/feedback)', read: readActionSchema },
];

for (const tool of SCHEMA_TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: `Get the JSON Schema for a ROS2 ${tool.kind} type, given its package and name.`,
      inputSchema: schemaInputShape,
    },
    ({ pkg, name }) => runTool(() => tool.read(pkg, name)),
  );
}

// --- Bridge tools (proxied into the live VS Code extension host via bridgeClient.ts) ---

server.registerTool(
  'get_ros2_focus',
  {
    title: 'Get focused ROS2 interface or live graph entry',
    description:
      'Get whatever the user currently has selected/focused (and everything they have pinned) in the ROS2 ' +
      'Webview panel in VS Code — each entry is either an installed interface definition ' +
      '({ source: "interface", kind: "msg"|"srv"|"action", pkg, name }) or a live topic/service/action from the ' +
      'running graph ({ source: "graph", kind: "topic"|"service"|"action", name, types }). Call this to find ' +
      'out what the user means by "this topic" / "this message" / "the current type" before asking them to ' +
      'repeat themselves.',
  },
  async () => {
    const result = await callBridge('/focus');
    return result.ok ? textResult(result.data) : errorResult(result.error);
  },
);

server.registerTool(
  'open_ros2_gui_preview',
  {
    title: 'Preview generated ROS2 GUI',
    description:
      'Open (or refresh) a live preview panel in VS Code for a generated web GUI HTML file, so the user can ' +
      'see and interact with it immediately. Pass the path to the main .html file (absolute, or relative to ' +
      'the workspace root); referenced local .js/.css/asset files in the same folder are resolved ' +
      'automatically. The panel auto-reloads whenever the file changes on disk.',
    inputSchema: {
      path: z.string().describe('Path to the HTML entry file, absolute or relative to the workspace root.'),
    },
  },
  async ({ path: filePath }) => {
    const result = await callBridge('/preview', { method: 'POST', body: { path: filePath } });
    return result.ok ? textResult({ opened: filePath }) : errorResult(result.error);
  },
);

server.registerTool(
  'generate_gui_scaffold',
  {
    title: 'Generate GUI scaffold from a layout',
    description:
      'Deterministically generate a GUI scaffold from a .ros2ui.json layout file: <name>.html (fixed panel ' +
      'geometry — position, size, and stacking order exactly as authored in the layout, one Shadow-DOM-isolated ' +
      '<div> per panel, never hand-edited) plus <name>.panels/<panelId>/{panel.html,style.css,script.js} — one ' +
      'folder per panel, created only the first time. Always run this before writing any GUI code for a ' +
      'layout — never hand-author full-page layout HTML/CSS, since hand-transcribed geometry drifts from the ' +
      'spec. After this succeeds, edit ONLY the files under <name>.panels/<panelId>/: panel.html (content ' +
      'fragment), style.css (Shadow-DOM-scoped, no prefixing needed), and script.js, which must define ' +
      '`window[\'mountPanel_<panelId>\'] = function(shadowRoot, ros, bindings) {...}` — everything scoped ' +
      'inside that function, never on window.*/document.* directly. Safe to re-run any time panels are ' +
      'added, removed, moved, or resized — existing panel folders are left untouched and never deleted.',
    inputSchema: {
      path: z.string().describe('Path to the .ros2ui.json layout file, absolute or relative to the workspace root.'),
    },
  },
  async ({ path: filePath }) => {
    const result = await callBridge('/scaffold', { method: 'POST', body: { path: filePath }, timeoutMs: 5000 });
    return result.ok ? textResult(result.data) : errorResult(result.error);
  },
);

const ROSBRIDGE_URL = process.env.ROS2_WEBVIEW_ROSBRIDGE_URL || 'ws://localhost:9090';

server.registerTool(
  'get_ros2_rosbridge_url',
  {
    title: 'Get rosbridge_server URL',
    description:
      'Get the WebSocket URL of the rosbridge_server instance configured for this workspace. Use this when ' +
      'generating a web-based GUI that talks to ROS2 live (e.g. via roslibjs\' `new ROSLIB.Ros({ url })`) for ' +
      'topics, services, and actions.',
  },
  async () => textResult({ url: ROSBRIDGE_URL }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
