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

const FOCUS_PORT = Number(process.env.ROS2_WEBVIEW_FOCUS_PORT) || 47823;

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
      response = await fetch(`http://127.0.0.1:${FOCUS_PORT}/focus`, { signal: AbortSignal.timeout(2000) });
    } catch (err) {
      return errorResult(
        `Could not reach the ROS2 Webview panel (${err instanceof Error ? err.message : String(err)}). ` +
        'Make sure the extension\'s webview panel is open in VS Code.',
      );
    }
    if (!response.ok) {
      return errorResult(`ROS2 Webview focus server returned HTTP ${response.status}.`);
    }
    return textResult(await response.json());
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
