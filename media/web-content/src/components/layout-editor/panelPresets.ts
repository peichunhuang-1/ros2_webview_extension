// Quick-start templates for the Notes field: writing a good freeform description of "what
// should this panel do" for every single panel was reported as the most tedious part of
// building a layout. Picking one of these fills Notes with a solid default in one click; the
// user (or Claude) can still edit the result, but for most panels this replaces typing a
// paragraph with a single click.
export interface PanelTypePreset { key: string; label: string; notes: string }

// A binding can be either { source: 'graph', name, ... } (a live topic/service/action with a
// real name already) or { source: 'interface', pkg, name, ... } (just a message/service/action
// *type* — no live name, and no guarantee it's used as a topic vs. a service/action call — a
// chart could just as well be fed by repeated service calls, a button could publish to a topic
// instead of calling a service, etc.). Append this reminder regardless of preset so the
// generated panel doesn't just hard-code a made-up name when there isn't a real one yet.
const INTERFACE_BINDING_NOTE = "If a binding is an interface (a type only, no live name yet), add a text input or select so the user can specify which topic/service/action to use.";

export const PANEL_TYPE_PRESETS: PanelTypePreset[] = [
  { key: 'chart', label: 'Chart', notes: `Live line chart of this topic's numeric field(s) over time (~30s rolling window), Y axis auto-scaled, current value shown in the corner. ${INTERFACE_BINDING_NOTE}` },
  { key: 'table', label: 'Table', notes: `Table of the latest message's fields as rows (name | value), updating live as new messages arrive. ${INTERFACE_BINDING_NOTE}` },
  { key: 'image', label: 'Image/video', notes: `Live image viewer for this topic's image data, fit to the panel, no controls. ${INTERFACE_BINDING_NOTE}` },
  { key: 'status', label: 'Status badge', notes: `Compact status indicator: colored dot + short text for the latest value/state. Green = nominal, red = problem, gray = no data yet. ${INTERFACE_BINDING_NOTE}` },
  { key: 'button', label: 'Button/trigger', notes: `Button(s) that call this service/action on click, showing a brief pending/success/error state after each click. ${INTERFACE_BINDING_NOTE}` },
  { key: 'slider', label: 'Slider/control', notes: `Slider (or number input) to set a numeric value and publish/call it, with the current value shown next to the control. ${INTERFACE_BINDING_NOTE}` },
];
