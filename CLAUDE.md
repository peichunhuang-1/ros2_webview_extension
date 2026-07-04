# ROS2 Webview Extension

## MCP tool usage (`ros2-interfaces` server, defined in `src/mcpServer.ts`)

- If the user refers to "this topic", "this message", "the current type", "what I selected/picked", or otherwise
  relies on prior selection state instead of naming a package/topic explicitly, call `get_ros2_focus` first —
  don't say you can't tell or ask them to repeat themselves without checking it. This applies to any phrasing of
  the same idea, not just an exact match to these examples.
- `list_ros2_interfaces` lists installed `.msg`/`.srv`/`.action` *definitions*. `list_ros2_graph` lists
  topics/services/actions *currently running*. These are not interchangeable — a type can be installed without
  anything running that uses it, and a running topic's exact name only comes from the graph, never from
  `list_ros2_interfaces`.
- Resolve every ROS2 package name, interface name, and type string through these tools before using it — never
  guess or recall one from a prior turn without re-checking, since the workspace/graph can change between calls.
