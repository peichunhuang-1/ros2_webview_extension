import * as vscode from 'vscode';
import { MCP_SERVER_NAME, mcpServerLaunch, readExtensionFile } from './workspaceConfig';

// Everything behind the "ROS2 Webview: Set Up Claude Code MCP Integration"
// command: registering the MCP server in .mcp.json, pre-approving its tools in
// .claude/settings.local.json, installing the CLAUDE.md managed block, and
// vendoring the web-design-engineer skill into the user's workspace.

const DISMISSED_KEY = 'ros2Mcp.setupDismissed';

type McpJson = { mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }> };

async function readMcpJson(uri: vscode.Uri): Promise<McpJson> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as McpJson;
  } catch {
    return {};
  }
}

type ClaudeSettingsJson = {
  enabledMcpjsonServers?: string[];
  permissions?: { allow?: string[] } & Record<string, unknown>;
} & Record<string, unknown>;

// Claude Code gates a project MCP server behind two separate approvals: first
// whether to trust the server declared in .mcp.json at all (enabledMcpjsonServers),
// then — once trusted — whether to approve each individual tool call
// (permissions.allow). Both have to be granted, or the user still gets
// prompted at the first gate even though the second is wide open. "Set Up"
// grants both up front rather than leaving the user to discover either by hand.
//
// Written to settings.local.json rather than settings.json: Claude Code
// requires the user to click through a one-time "trust this folder" prompt
// before it honors *project*-tier settings (committed, potentially authored
// by someone else) — but settings.local.json is a different tier, always
// treated as the user's own, so these grants take effect immediately with
// no extra prompt.
async function grantClaudeCodeMcpPermission(folder: vscode.WorkspaceFolder): Promise<void> {
  const settingsUri = vscode.Uri.joinPath(folder.uri, '.claude', 'settings.local.json');
  const permissionRule = `mcp__${MCP_SERVER_NAME}__*`;

  let settings: ClaudeSettingsJson = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(settingsUri);
    settings = JSON.parse(Buffer.from(bytes).toString('utf8')) as ClaudeSettingsJson;
  } catch {
    // No existing file (or unreadable) — start fresh rather than fail setup.
  }

  const enabledServers = (settings.enabledMcpjsonServers ??= []);
  if (!enabledServers.includes(MCP_SERVER_NAME)) {
    enabledServers.push(MCP_SERVER_NAME);
  }

  settings.permissions ??= {};
  const allow = (settings.permissions.allow ??= []);
  if (!allow.includes(permissionRule)) {
    allow.push(permissionRule);
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.claude'));
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(JSON.stringify(settings, null, 2) + '\n', 'utf8'));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CLAUDE_MD_BLOCK_START = '<!-- ros2-webview-extension: managed block, edits here are overwritten by "Set Up" -->';
const CLAUDE_MD_BLOCK_END = '<!-- /ros2-webview-extension -->';

// CLAUDE.md is project-scoped — Claude Code only reads it from whatever workspace it's
// pointed at, so bundling it with the extension does nothing for a user's own ROS2 project
// until it's copied there. "Set Up" does that, the same way it already does for .mcp.json
// and settings.local.json above.
//
// The MCP server's own `instructions` field (see mcpServer.ts) carries a condensed version
// of this same guidance unconditionally, over the protocol itself, regardless of whether the
// user ever runs "Set Up" — this file-based copy is the fuller version for those who do.
async function installClaudeMdSection(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  const claudeMdUri = vscode.Uri.joinPath(folder.uri, 'CLAUDE.md');
  const sectionBody = (await readExtensionFile(context, 'CLAUDE.md')).trim();
  const block = `${CLAUDE_MD_BLOCK_START}\n${sectionBody}\n${CLAUDE_MD_BLOCK_END}`;

  let existing = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(claudeMdUri);
    existing = Buffer.from(bytes).toString('utf8');
  } catch {
    // No existing file — the block becomes the entire content.
  }

  const blockRe = new RegExp(`${escapeRegExp(CLAUDE_MD_BLOCK_START)}[\\s\\S]*?${escapeRegExp(CLAUDE_MD_BLOCK_END)}`);
  const next = blockRe.test(existing)
    ? existing.replace(blockRe, block)
    : existing
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;

  await vscode.workspace.fs.writeFile(claudeMdUri, Buffer.from(next, 'utf8'));
}

// Vendored from https://github.com/ConardLi/web-design-skill (skills/web-design-engineer) so
// Claude has real design-system guidance (design tokens, anti-AI-cliché rules, style recipes)
// available when a user asks for visual polish on a generated GUI, not just the narrow
// per-panel defaults baked into scaffoldGen.ts. Copied wholesale (vscode.workspace.fs.copy
// handles the directory recursively) and always overwritten on Set Up, same as CLAUDE.md's
// managed block — it's third-party vendored content, not something a user hand-edits in place.
async function installDesignSkill(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  const sourceUri = vscode.Uri.joinPath(context.extensionUri, '.claude', 'skills', 'web-design-engineer');
  const targetUri = vscode.Uri.joinPath(folder.uri, '.claude', 'skills', 'web-design-engineer');
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.claude', 'skills'));
  await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: true });
}

export async function setupClaudeCodeMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Open a folder/workspace first to set up the ROS2 MCP server.');
    return;
  }

  const mcpJsonUri = vscode.Uri.joinPath(folder.uri, '.mcp.json');
  const config = await readMcpJson(mcpJsonUri);
  config.mcpServers ??= {};
  config.mcpServers[MCP_SERVER_NAME] = mcpServerLaunch(context);

  await vscode.workspace.fs.writeFile(mcpJsonUri, Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8'));
  await grantClaudeCodeMcpPermission(folder);
  await installClaudeMdSection(folder, context);
  await installDesignSkill(folder, context);
  vscode.window.showInformationMessage(
    'ROS2 MCP server registered in .mcp.json (tool calls pre-approved) with CLAUDE.md guidance and the ' +
    'web-design-engineer skill installed. Restart Claude Code (or run /mcp) to pick it up.',
  );
}

export async function maybeOfferMcpSetup(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || context.globalState.get<boolean>(DISMISSED_KEY)) { return; }

  const config = await readMcpJson(vscode.Uri.joinPath(folder.uri, '.mcp.json'));
  if (config.mcpServers?.[MCP_SERVER_NAME]) { return; }

  const choice = await vscode.window.showInformationMessage(
    'Let Claude Code read ROS2 msg/srv/action schemas in this workspace via MCP?',
    'Set Up', "Don't Ask Again",
  );
  if (choice === 'Set Up') {
    await setupClaudeCodeMcp(context);
  } else if (choice === "Don't Ask Again") {
    await context.globalState.update(DISMISSED_KEY, true);
  }
}
