#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isRos2Available, listInterfaces, readMsgSchema, readSrvSchema, readActionSchema } from './schemaGen';

const server = new McpServer({ name: 'ros2-interfaces', version: '0.0.1' });

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

const BRIDGE_PORT = Number(process.env.ROS2_WEBVIEW_BRIDGE_PORT) || 47823;

server.registerTool(
  'get_ros2_focus',
  {
    title: 'Get focused ROS2 interface',
    description:
      'Get the msg/srv/action interface the user currently has selected/focused in the ROS2 Webview panel ' +
      'in VS Code, plus the full list of interfaces they have pinned there. Call this to find out what the ' +
      'user means by "this message" or "the current type" before asking them to repeat themselves.',
  },
  async () => {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/focus`, { signal: AbortSignal.timeout(2000) });
    } catch (err) {
      return errorResult(
        `Could not reach the ROS2 Webview extension (${err instanceof Error ? err.message : String(err)}). ` +
        'Make sure VS Code with the extension is running.',
      );
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
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
        signal: AbortSignal.timeout(2000),
      });
    } catch (err) {
      return errorResult(
        `Could not reach the ROS2 Webview extension (${err instanceof Error ? err.message : String(err)}). ` +
        'Make sure VS Code with the extension is running.',
      );
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
