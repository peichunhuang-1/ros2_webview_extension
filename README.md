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

**Build everything (webview + extension):**

```sh
# 1. Build the React webview
cd media/web-content && npm run build && cd ../..

# 2. Compile the extension
npm run compile
```

**Package as .vsix:**

```sh
npm run vsix
```

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
  extension.ts          # Extension entry point
  WebviewPanelProvider.ts  # Webview host + message router
  ros2Connection.ts     # Connect/disconnect + in-memory schema cache
  schemaGen.ts          # Parses .msg/.srv/.action files → JSON schema
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
