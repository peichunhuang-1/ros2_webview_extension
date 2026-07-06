# ROS2 Webview Extension

A VS Code extension for building and previewing custom UIs for ROS2 topics, services, and actions.

## Prerequisites

- Docker (see platform notes below)
- VS Code with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension

### macOS

Docker Engine cannot run natively on macOS — a Linux VM is required. Two options:

**Docker Desktop** (requires a commercial license for large organisations)
After installing, go to **Settings → General** and enable **"Allow the default Docker socket to be used"**.

**Colima** (free, no license restrictions)
```sh
brew install colima docker
colima start
```
Add to `~/.zshrc` so VS Code can find the socket:
```sh
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
```
Run `source ~/.zshrc` then verify with `docker info`. Colima must be running (`colima start`) each time you open the devcontainer.

### Linux

Install Docker Engine from your distro's package manager — no extra tools needed:
```sh
# Debian/Ubuntu
sudo apt-get install docker.io
sudo usermod -aG docker $USER   # allow running docker without sudo (re-login after)
```
VS Code will find the socket at `/var/run/docker.sock` automatically.

---

## Opening the dev environment

1. Open this folder in VS Code
2. Press `Cmd+Shift+P` → **Dev Containers: Reopen in Container**
3. Wait for the container to build (first time takes a few minutes)
4. Once inside the container, the terminal will be running inside ROS2 Humble

The `postCreateCommand` automatically runs `npm install` for both the extension and the webview.

---

## Building

**Build everything (webview + extension), e.g. before F5 debugging:**

```sh
# 1. Build the React webview
npm run build:webview

# 2. Compile the extension
npm run compile
```

**Package as .vsix:**

```sh
npm run vsix
```

`npm run vsix` runs `vscode:prepublish` → `npm run package`, which builds the webview (`build:webview`) and then the extension itself, so the packaged `.vsix` always ships with fresh webview assets. `media/web-content/dist` is gitignored — if you build the webview manually and skip `npm run package`/`npm run vsix` when packaging, the `.vsix` will be missing the webview UI and the sidebar view will fail to load with "An error occurred while loading view: editorWebview".

---

## Running & debugging

1. Open **Run → Start Debugging** (or `Cmd+Shift+P` → **Debug: Start Debugging**)
2. An **Extension Development Host** window opens with the extension loaded
3. Click the **Webview** icon in the Activity Bar (left sidebar)
4. Click **Connect** — the status bar should show `● Connected · ROS2 humble`

To inspect webview errors, open **Help → Toggle Developer Tools** inside the Extension Development Host window.

---

## Iterative development

Open two terminals in the container to avoid rebuilding manually:

```sh
# Terminal 1 — watch extension TypeScript
npm run watch

# Terminal 2 — watch webview
cd media/web-content && npm run build -- --watch
```

Then start debugging once. After saving a file, reload the Extension Development Host window with `Ctrl+R` (inside that window) to pick up changes.

---

## Project structure

```
.devcontainer/          # Docker + devcontainer config (ROS2 Humble + Node.js 20)
src/
  extension.ts          # Extension entry point; also sets up the Claude Code MCP integration
  WebviewPanelProvider.ts  # Webview host + message router
  ros2Connection.ts     # Connect/disconnect + in-memory schema cache
  schemaGen.ts          # Parses .msg/.srv/.action files → JSON schema
  mcpServer.ts          # MCP server ("ros2-interfaces") exposing ROS2 introspection to Claude
  scaffoldGen.ts        # Generates the GUI scaffold (dashboard.html + per-panel files) from a layout
  vendor.d.ts           # Type stubs for rclnodejs subpath imports
media/web-content/      # React webview (Vite)
  src/
    ros2_apis/
      bridge.ts         # postMessage request/response bridge
      bridge_types.ts   # Message type constants and payload types
      ros2Api.ts        # Typed wrappers: connect(), getMsgSchema(), …
    App.tsx             # Main UI: Connect button + status
```

## How schema lookup works

```
[Webview] ros2Api.getMsgSchema("geometry_msgs", "Twist")
    │  postMessage  ros2/schema/msg
    ▼
[Extension host] ros2Connection.getMsgSchema(pkg, name)
    │  reads .msg file via AMENT_PREFIX_PATH
    ▼
[schemaGen.ts] parses geometry_msgs/msg/Twist.msg
    │
    ▼
{ properties: { linear: { … }, angular: { … } } }   ← returned to webview
```

Parsed schemas are cached in memory for the session so each type is only read once.

---

## Generating a GUI from a layout

Design the layout visually in the Layout Editor (`*.ros2ui.json`), then run **"ROS2 Webview: Generate
GUI Scaffold"** (Command Palette, the title-bar button on the layout editor, or the `generate_gui_scaffold`
MCP tool) instead of asking Claude to hand-write the whole page. It deterministically produces, next to
`dashboard.ros2ui.json`:

- `dashboard.html` — the full page, with one absolutely-positioned `<div>` per panel (position, size,
  and stacking order baked in exactly as specified), each rendered into its own Shadow DOM. This file
  is a build artifact: it's fully regenerated every time the command runs and should never be hand-edited.
- `dashboard.panels/<panelId>/{panel.html, style.css, script.js}` — one folder per panel, created once.
  This is the only place to author content — the layout's `notes` and `bindings` for that panel are
  included in the generated comments to give Claude context. `script.js` defines
  `window['mountPanel_<panelId>'] = function(shadowRoot, ros, bindings) {...}`, called once a shared
  `ROSLIB.Ros` connection is ready; Shadow DOM keeps each panel's CSS/DOM isolated from every other
  panel, so panels can be styled and scripted independently without collisions.

Re-run the command any time panels are added, removed, moved, or resized in the Layout Editor —
existing panel folders are left untouched, and only new panels get stub files. You don't need to
remember to re-run it before previewing, though: opening (or refreshing) the preview via
`open_ros2_gui_preview` / "ROS2 Webview: Preview Generated UI" automatically regenerates
`dashboard.html` from the layout and the current `panel.html`/`style.css`/`script.js` contents first,
so it can never show a stale snapshot from before your last edit.

The generated page connects to `rosbridge_server` (via `roslibjs`) at the URL configured in
`ros2Webview.rosbridgeUrl` — that process is not started by this extension, so it must already be
running separately (e.g. `ros2 launch rosbridge_server rosbridge_websocket_launch.xml`) for panels to
receive live data. A small status badge in the bottom-right corner of the generated page reports the
connection state (connecting / connected / error) so a failed connection is visible on the page itself,
not just in the DevTools console.

---

## Claude Code MCP integration

The extension bundles an MCP server (`ros2-interfaces`, `src/mcpServer.ts`) so Claude Code can look up ROS2
interfaces and the live graph directly. Run **"ROS2 Webview: Set Up Claude Code MCP Integration"** from the
Command Palette in a workspace to register it — this writes `.mcp.json` and grants the server/its tools
pre-approved permission in `.claude/settings.local.json`, so you aren't prompted to approve each call.

Tools exposed:
- `list_ros2_interfaces` — installed `.msg`/`.srv`/`.action` definitions
- `list_ros2_graph` — topics/services/actions currently running
- `get_ros2_msg_schema` / `get_ros2_srv_schema` / `get_ros2_action_schema` — field schemas for a given type
- `get_ros2_focus` — whatever the user currently has selected/pinned in the Webview sidebar
- `get_ros2_rosbridge_url` — the configured rosbridge WebSocket URL
- `open_ros2_gui_preview` — opens/refreshes a live preview panel for a generated HTML file
- `generate_gui_scaffold` — generates the GUI scaffold (`dashboard.html` + per-panel files) from a `.ros2ui.json` layout
