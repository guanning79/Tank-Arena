# Tank Arena Map Data Format

## Overview

Maps are stored in JSON format with metadata and tile data. The format is designed to be efficient, human-readable, and easy to parse in JavaScript.

## File Structure

```json
{
  "version": "1.0",
  "mapSize": 512,
  "tileSize": 8,
  "tiles": [
    [0, 1, 2, ...],
    [1, 0, 3, ...],
    ...
  ]
}
```

## Fields

### `version` (string)
- Format version identifier
- Current version: `"1.0"`

### `mapSize` (integer)
- Map dimensions in pixels (not tiles)
- Valid values: `512`, `1024`, `2048`
- Represents a square map: `mapSize × mapSize` pixels
- Tile count per side: `mapSize / tileSize`

### `tileSize` (integer)
- Size of each tile in pixels
- Current value: `8`
- Total tiles per side: `mapSize / tileSize`

### `tiles` (2D array)
- Two-dimensional array of tile IDs
- `tiles[row][col]` where row and col are 0-indexed
- Each value is an integer representing a tile type (0-7)
- Grid size should be `(mapSize / tileSize) × (mapSize / tileSize)`

## Tile Types

| ID | Name | Accessible | Destructible | Blocks Bullet | Special Properties |
|----|------|------------|--------------|---------------|-------------------|
| 0 | Soil | ✅ | ❌ | ❌ | - |
| 1 | Water | ❌ | ❌ | ❌ | - |
| 2 | Brick Wall | ❌ | ✅ | ❌ | - |
| 3 | Grass | ✅ | ❌ | ❌ | Makes tank invisible |
| 4 | Steel Wall | ❌ | ❌ | ✅ | Blocks bullets |
| 5 | AI Tank Spawn Point | ✅ | ❌ | ❌ | Spawn point for AI tanks |
| 6 | Player Tank Spawn Point | ✅ | ❌ | ❌ | Spawn point for player |
| 7 | Player HQ | ❌ | ✅ | ❌ | Headquarters building |

## Tile Properties Reference

### Accessible
- Tanks can move onto this tile
- Used for pathfinding and collision detection

### Destructible
- Can be destroyed by bullets or explosions
- Health system may apply

### Blocks Bullet
- Bullets cannot pass through
- Used for cover mechanics

### Special Properties
- **Grass**: Tanks on grass tiles are invisible or harder to detect
- **Spawn Points**: Designated starting positions for tanks
- **HQ**: Main objective/target building

## Example Map

```json
{
  "version": "1.0",
  "mapSize": 512,
  "tileSize": 8,
  "tiles": [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 3, 3, 1, 1, 3, 3, 0],
    [0, 3, 2, 2, 2, 2, 3, 0],
    [1, 1, 2, 6, 5, 2, 1, 1],
    [1, 1, 2, 5, 5, 2, 1, 1],
    [0, 3, 2, 2, 2, 2, 3, 0],
    [0, 3, 3, 4, 4, 3, 3, 0],
    [0, 0, 0, 7, 7, 0, 0, 0]
  ]
}
```

## Usage in JavaScript

### Loading a Map

```javascript
async function loadMap(filename) {
    const response = await fetch(filename);
    const mapData = await response.json();
    
    const mapSize = mapData.mapSize;
    const tileSize = mapData.tileSize;
    const tiles = mapData.tiles;
    
    return {
        size: mapSize,
        tileSize: tileSize,
        tiles: tiles,
        getTile: (row, col) => tiles[row][col],
        isAccessible: (row, col) => {
            const tileId = tiles[row][col];
            const accessibleTiles = [0, 3, 5, 6]; // Soil, Grass, Spawn Points
            return accessibleTiles.includes(tileId);
        },
        isDestructible: (row, col) => {
            const tileId = tiles[row][col];
            return tileId === 2 || tileId === 7; // Brick Wall, HQ
        },
        blocksBullet: (row, col) => {
            return tiles[row][col] === 4; // Steel Wall
        },
        isGrass: (row, col) => {
            return tiles[row][col] === 3;
        }
    };
}
```

### Tile Type Constants

```javascript
const TILE_TYPES = {
    SOIL: 0,
    WATER: 1,
    BRICK_WALL: 2,
    GRASS: 3,
    STEEL_WALL: 4,
    AI_SPAWN: 5,
    PLAYER_SPAWN: 6,
    PLAYER_HQ: 7
};

const TILE_PROPERTIES = {
    [TILE_TYPES.SOIL]: { accessible: true, destructible: false, blocksBullet: false },
    [TILE_TYPES.WATER]: { accessible: false, destructible: false, blocksBullet: false },
    [TILE_TYPES.BRICK_WALL]: { accessible: false, destructible: true, blocksBullet: false },
    [TILE_TYPES.GRASS]: { accessible: true, destructible: false, blocksBullet: false, invisible: true },
    [TILE_TYPES.STEEL_WALL]: { accessible: false, destructible: false, blocksBullet: true },
    [TILE_TYPES.AI_SPAWN]: { accessible: true, destructible: false, blocksBullet: false },
    [TILE_TYPES.PLAYER_SPAWN]: { accessible: true, destructible: false, blocksBullet: false },
    [TILE_TYPES.PLAYER_HQ]: { accessible: false, destructible: true, blocksBullet: false }
};
```

### Coordinate Conversion

```javascript
// Convert pixel coordinates to tile coordinates
function pixelToTile(pixelX, pixelY, tileSize) {
    return {
        col: Math.floor(pixelX / tileSize),
        row: Math.floor(pixelY / tileSize)
    };
}

// Convert tile coordinates to pixel coordinates
function tileToPixel(tileCol, tileRow, tileSize) {
    return {
        x: tileCol * tileSize,
        y: tileRow * tileSize
    };
}
```

## File Naming Convention

Recommended naming: `map_<size>_<name>.json`

Examples:
- `map_512_arena.json`
- `map_1024_battlefield.json`
- `map_2048_campaign.json`

## Validation

A valid map file must:
1. Have `version`, `mapSize`, `tileSize`, and `tiles` fields
2. `mapSize` must be 512, 1024, or 2048
3. `tileSize` must be 8
4. `tiles` must be a 2D array with dimensions `mapSize × mapSize`
5. All tile values must be integers between 0 and 7

## Performance Considerations

- For 512×512 maps: ~1MB JSON file
- For 1024×1024 maps: ~4MB JSON file
- For 2048×2048 maps: ~16MB JSON file

Consider compression or binary format for larger maps in production.
