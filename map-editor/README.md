# Tank Arena Map Editor

A Python-based map editor for creating and editing Tank Arena game maps.

## Features

- **Multiple Map Sizes**: 512x512, 1024x1024, 2048x2048 pixels
- **Tile-Based Editing**: 8x8 pixel tiles
- **Multiple Tile Types**: 8 different terrain and object types
- **Area Selection**: Select and fill areas with tiles
- **Save/Load**: JSON-based map data format
- **Visual Editor**: Intuitive GUI with tile palette

## Installation

Requires Python 3.7+ with tkinter (usually included with Python).

```bash
python map_editor.py
```

## Usage

1. **Select Map Size**: Choose from 512x512, 1024x1024, or 2048x2048
2. **Select Tile Type**: Click on a tile in the palette
3. **Place Tiles**: Click on the map to place selected tile
4. **Fill Area**: Click and drag to select area, then click "Fill Selected Area"
5. **Save Map**: File → Save or Ctrl+S
6. **Load Map**: File → Open or Ctrl+O

## Map Data Format

See `MAP_DATA_FORMAT.md` for detailed documentation on the map data structure.

## Click-to-Render Flow

This is the current code flow from a mouse click to a rendered image update:

1. **Click event entry**: `on_canvas_click(event)`
   - Convert mouse position to tile coords via `canvas_to_tile()`
   - Write tile value: `self.tiles[row][col] = self.selected_tile`
   - Record dirty tiles in `dirty_tile_list` (row, col)
   - Do **not** redraw immediately

2. **Mouse release**: `on_canvas_release(event)`
   - Set `self.needs_redraw = True`

3. **Render pass**: `draw_map()`
   - draw_map() is called by the editor redraw loop
   - If `self.needs_redraw` is True and cache is dirty, call `update_map_image_cache()`
   - Draw cached image via `self.canvas.create_image(...)`
   - Update scroll region: `self.canvas.config(scrollregion=...)`

4. **Cache update**: `update_map_image_cache()`
   - If `map_image` exists, update only the region indicated by `dirty_tile_list`
   - Reset `self.needs_redraw` and `dirty_tile_list`

## PIL Cache and Zoom Cache Flow

This describes how `map_image_pil` and the zoomed cache are created and refreshed:

1. **Base map cache**: `update_map_image_cache()` → `generate_map_image()`
   - For large maps, `generate_map_image()` may build a PIL image for speed.
   - When that happens, the PIL image is stored in `self.map_image_pil` and
     the Tk image is stored in `self.map_image`.

3. **Zoomed cache**: `get_zoomed_map_image()`
   - When `self.zoom != 1.0`, the PIL base image is resized with nearest-neighbor
     into a new `PhotoImage`.
   - The result is cached as `self.map_image_zoomed` and keyed by `self.map_image_zoom`.

4. **Cache invalidation**
   - After any cache update or region update, `self.map_image_zoomed` is cleared.
   - Call `get_zoomed_map_image()` to generate a new `self.map_image_zoomed` based on `self.map_image`

## Testing

Run the test script to verify map size switching functionality:

```bash
python test_map_size_switch.py
```

This script will:
- Create a 512x512 test map
- Switch to 2048x2048 map size
- Save the map as `maps/test.json`
- Validate map data integrity
