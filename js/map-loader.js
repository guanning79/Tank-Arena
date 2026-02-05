/**
 * Map Loader for Tank Arena
 * Utility functions for loading and working with map data
 */

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
    [TILE_TYPES.SOIL]: { 
        name: "Soil",
        accessible: true, 
        destructible: false, 
        blocksBullet: false,
        color: "#8B4513"
    },
    [TILE_TYPES.WATER]: { 
        name: "Water",
        accessible: false, 
        destructible: false, 
        blocksBullet: false,
        color: "#4169E1"
    },
    [TILE_TYPES.BRICK_WALL]: { 
        name: "Brick Wall",
        accessible: false, 
        destructible: true, 
        blocksBullet: false,
        color: "#CD5C5C"
    },
    [TILE_TYPES.GRASS]: { 
        name: "Grass",
        accessible: true, 
        destructible: false, 
        blocksBullet: false,
        invisible: true,
        color: "#228B22"
    },
    [TILE_TYPES.STEEL_WALL]: { 
        name: "Steel Wall",
        accessible: false, 
        destructible: false, 
        blocksBullet: true,
        color: "#708090"
    },
    [TILE_TYPES.AI_SPAWN]: { 
        name: "AI Tank Spawn",
        accessible: true, 
        destructible: false, 
        blocksBullet: false,
        color: "#FF0000"
    },
    [TILE_TYPES.PLAYER_SPAWN]: { 
        name: "Player Tank Spawn",
        accessible: true, 
        destructible: false, 
        blocksBullet: false,
        color: "#00FF00"
    },
    [TILE_TYPES.PLAYER_HQ]: { 
        name: "Player HQ",
        accessible: false, 
        destructible: true, 
        blocksBullet: false,
        color: "#FFD700"
    }
};

/**
 * Load a map from a JSON file
 * @param {string} filename - Path to the map JSON file
 * @returns {Promise<MapData>}
 */
async function loadMap(filename) {
    try {
        const response = await fetch(filename, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load map: ${response.statusText}`);
        }
        
        const mapData = await response.json();
        
        // Validate map data
        if (!mapData.version || !mapData.mapSize || !mapData.tiles) {
            throw new Error("Invalid map file format");
        }
        
        if (![512, 1024, 2048].includes(mapData.mapSize)) {
            throw new Error(`Invalid map size: ${mapData.mapSize}`);
        }
        
        const expectedTileSize = typeof MAP_TILE_SIZE !== 'undefined' ? MAP_TILE_SIZE : 8;
        if (mapData.tileSize !== expectedTileSize) {
            throw new Error(`Invalid tile size: ${mapData.tileSize}`);
        }
        
        const tilesPerSide = mapData.mapSize / mapData.tileSize;
        if (!Number.isInteger(tilesPerSide)) {
            throw new Error(`Invalid map size/tile size ratio: ${mapData.mapSize}/${mapData.tileSize}`);
        }
        
        // Validate dimensions
        if (mapData.tiles.length !== tilesPerSide) {
            throw new Error(`Map height mismatch: expected ${tilesPerSide}, got ${mapData.tiles.length}`);
        }
        
        for (let row = 0; row < mapData.tiles.length; row++) {
            if (mapData.tiles[row].length !== tilesPerSide) {
                throw new Error(`Map width mismatch at row ${row}: expected ${tilesPerSide}, got ${mapData.tiles[row].length}`);
            }
        }
        
        return new MapData(mapData);
    } catch (error) {
        console.error("Error loading map:", error);
        throw error;
    }
}

/**
 * MapData class - Wrapper for map data with utility methods
 */
class MapData {
    constructor(mapData) {
        this.version = mapData.version;
        this.mapSize = mapData.mapSize;
        this.tileSize = mapData.tileSize;
        this.tiles = mapData.tiles;
        this.tilesPerSide = mapData.mapSize / mapData.tileSize;
    }
    
    /**
     * Get tile ID at given coordinates
     * @param {number} row - Row index (0-based)
     * @param {number} col - Column index (0-based)
     * @returns {number} Tile ID
     */
    getTile(row, col) {
        if (row < 0 || row >= this.tilesPerSide || col < 0 || col >= this.tilesPerSide) {
            return null; // Out of bounds
        }
        return this.tiles[row][col];
    }
    
    /**
     * Get tile properties at given coordinates
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {Object|null} Tile properties or null if out of bounds
     */
    getTileProperties(row, col) {
        const tileId = this.getTile(row, col);
        if (tileId === null) return null;
        return TILE_PROPERTIES[tileId] || null;
    }
    
    /**
     * Check if a tile is accessible (tanks can move on it)
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean}
     */
    isAccessible(row, col) {
        const props = this.getTileProperties(row, col);
        return props ? props.accessible : false;
    }
    
    /**
     * Check if a tile is destructible
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean}
     */
    isDestructible(row, col) {
        const props = this.getTileProperties(row, col);
        return props ? props.destructible : false;
    }
    
    /**
     * Check if a tile blocks bullets
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean}
     */
    blocksBullet(row, col) {
        const props = this.getTileProperties(row, col);
        return props ? props.blocksBullet : false;
    }
    
    /**
     * Check if a tile is grass (makes tanks invisible)
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean}
     */
    isGrass(row, col) {
        return this.getTile(row, col) === TILE_TYPES.GRASS;
    }
    
    /**
     * Convert pixel coordinates to tile coordinates
     * @param {number} pixelX - X coordinate in pixels
     * @param {number} pixelY - Y coordinate in pixels
     * @returns {{row: number, col: number}} Tile coordinates
     */
    pixelToTile(pixelX, pixelY) {
        return {
            col: Math.floor(pixelX / this.tileSize),
            row: Math.floor(pixelY / this.tileSize)
        };
    }
    
    /**
     * Convert tile coordinates to pixel coordinates (top-left corner)
     * @param {number} col - Column index
     * @param {number} row - Row index
     * @returns {{x: number, y: number}} Pixel coordinates
     */
    tileToPixel(col, row) {
        return {
            x: col * this.tileSize,
            y: row * this.tileSize
        };
    }
    
    /**
     * Get all spawn points of a specific type
     * @param {number} spawnType - TILE_TYPES.AI_SPAWN or TILE_TYPES.PLAYER_SPAWN
     * @returns {Array<{row: number, col: number}>} Array of spawn point coordinates
     */
    getSpawnPoints(spawnType) {
        const spawns = [];
        for (let row = 0; row < this.tilesPerSide; row++) {
            for (let col = 0; col < this.tilesPerSide; col++) {
                if (this.getTile(row, col) === spawnType) {
                    spawns.push({ row, col });
                }
            }
        }
        return spawns;
    }
    
    /**
     * Get player HQ location
     * @returns {{row: number, col: number}|null} HQ coordinates or null
     */
    getPlayerHQ() {
        for (let row = 0; row < this.tilesPerSide; row++) {
            for (let col = 0; col < this.tilesPerSide; col++) {
                if (this.getTile(row, col) === TILE_TYPES.PLAYER_HQ) {
                    return { row, col };
                }
            }
        }
        return null;
    }
    
    /**
     * Check if a bullet path is blocked
     * @param {number} x1 - Start X in pixels
     * @param {number} y1 - Start Y in pixels
     * @param {number} x2 - End X in pixels
     * @param {number} y2 - End Y in pixels
     * @returns {boolean} True if path is blocked
     */
    isBulletPathBlocked(x1, y1, x2, y2) {
        const start = this.pixelToTile(x1, y1);
        const end = this.pixelToTile(x2, y2);
        
        // Simple line traversal
        const dx = Math.abs(end.col - start.col);
        const dy = Math.abs(end.row - start.row);
        const sx = start.col < end.col ? 1 : -1;
        const sy = start.row < end.row ? 1 : -1;
        let err = dx - dy;
        
        let x = start.col;
        let y = start.row;
        
        while (true) {
            if (this.blocksBullet(y, x)) {
                return true;
            }
            
            if (x === end.col && y === end.row) {
                break;
            }
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
        
        return false;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadMap, MapData, TILE_TYPES, TILE_PROPERTIES };
}
