import type { LayoutDocument } from '../../ros2_apis/bridge_types';
import { DEFAULT_GRID_SIZE, MIN_CANVAS_SIZE, MIN_GRID_SIZE } from './layoutModel';
import NumberField from './NumberField';

// The "Config" tab: canvas dimensions and grid size.
export default function LayoutConfigPanel({ canvas, onChange }: {
  canvas: LayoutDocument['canvas'];
  onChange: (changes: Partial<LayoutDocument['canvas']>) => void;
}) {
  return (
    <div className="layout-config">
      <p className="hint">
        These settings control the canvas every panel is positioned on. Changing the canvas size
        rescales what you see here to fit the editor, but panel pixel coordinates are unaffected —
        resize the canvas to match your target screen so panel ratios line up correctly.
      </p>

      <NumberField
        label="Canvas width (px)"
        value={canvas.width}
        min={MIN_CANVAS_SIZE}
        onCommit={width => onChange({ width })}
      />
      <NumberField
        label="Canvas height (px)"
        value={canvas.height}
        min={MIN_CANVAS_SIZE}
        onCommit={height => onChange({ height })}
      />
      <NumberField
        label="Grid size (px)"
        value={canvas.gridSize || DEFAULT_GRID_SIZE}
        min={MIN_GRID_SIZE}
        onCommit={gridSize => onChange({ gridSize })}
      />
    </div>
  );
}
