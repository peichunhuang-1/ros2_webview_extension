#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isRos2Available, listInterfaces, readMsgSchema, readSrvSchema, readActionSchema } from './schemaGen';
import { listGraph } from './ros2Graph';
import { readBridgeRegistry } from './bridgeRegistry';

// Sent to any MCP client during the initialize handshake (per the MCP spec,
// clients MAY surface this to the model as guidance). Unlike CLAUDE.md or a
// project skill, this travels with the server itself rather than living in
// a specific workspace — so it applies no matter which ROS2 project this
// extension is installed into, not just this extension's own source repo.
const SERVER_INSTRUCTIONS = [
  'When the user refers to a previous selection ambiguously ("this topic", "this message", "what I picked", ' +
    'etc.) instead of naming a package/topic explicitly, call get_ros2_focus first rather than asking them to ' +
    'repeat themselves or saying you can\'t tell.',
].join('\n\n');

const server = new McpServer({ name: 'ros2-interfaces', version: '0.0.1' }, { instructions: SERVER_INSTRUCTIONS });

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

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
  async () => {
    try {
      return textResult(await listGraph());
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
);

const schemaInputShape = {
  pkg:  z.string().describe('The ROS2 package name, e.g. "geometry_msgs"'),
  name: z.string().describe('The interface name without extension, e.g. "Twist"'),
};

server.registerTool(
  'get_ros2_msg_schema',
  {
    title: 'Get ROS2 message schema',
    description: 'Get the JSON Schema for a ROS2 message (.msg) type, given its package and name.',
    inputSchema: schemaInputShape,
  },
  async ({ pkg, name }) => {
    try {
      return textResult(await readMsgSchema(pkg, name));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
);

server.registerTool(
  'get_ros2_srv_schema',
  {
    title: 'Get ROS2 service schema',
    description: 'Get the JSON Schema for a ROS2 service (.srv) request type, given its package and name.',
    inputSchema: schemaInputShape,
  },
  async ({ pkg, name }) => {
    try {
      return textResult(await readSrvSchema(pkg, name));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
);

server.registerTool(
  'get_ros2_action_schema',
  {
    title: 'Get ROS2 action schema',
    description: 'Get the JSON Schema for a ROS2 action (.action) type (goal/result/feedback), given its package and name.',
    inputSchema: schemaInputShape,
  },
  async ({ pkg, name }) => {
    try {
      return textResult(await readActionSchema(pkg, name));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
);

// The workspace key must match what extension.ts derives (workspace folder fsPath) so we
// read the registry file the currently-active VS Code window last wrote to (see bridgeRegistry.ts).
const WORKSPACE_KEY = process.env.ROS2_WEBVIEW_WORKSPACE || process.cwd();

// Re-read on every call rather than caching: the registered window (and its port) can
// change any time a window reloads or a new one activates.
function resolveBridgePort(): number | null {
  return readBridgeRegistry(WORKSPACE_KEY)?.port ?? null;
}

const NO_BRIDGE_ERROR =
  'No active ROS2 Webview window is registered for this workspace. Open the "ROS2 Webview" panel ' +
  '(the icon in the Activity Bar) in VS Code to activate the extension.';

function unreachableBridgeError(port: number, err: unknown): ReturnType<typeof errorResult> {
  return errorResult(
    `Could not reach the ROS2 Webview extension on port ${port} (${err instanceof Error ? err.message : String(err)}). ` +
    'The registered VS Code window may have been closed or become unresponsive (e.g. a paused debug session) — ' +
    'try closing extra windows for this workspace and reloading the one you are using.',
  );
}

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
    const port = resolveBridgePort();
    if (port === null) { return errorResult(NO_BRIDGE_ERROR); }

    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/focus`, { signal: AbortSignal.timeout(2000) });
    } catch (err) {
      return unreachableBridgeError(port, err);
    }
    if (!response.ok) {
      return errorResult(`ROS2 Webview bridge server returned HTTP ${response.status}.`);
    }
    return textResult(await response.json());
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
    const port = resolveBridgePort();
    if (port === null) { return errorResult(NO_BRIDGE_ERROR); }

    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
        signal: AbortSignal.timeout(2000),
      });
    } catch (err) {
      return unreachableBridgeError(port, err);
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return errorResult(data.error ?? `HTTP ${response.status}`);
    }
    return textResult({ opened: filePath });
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
