#!/usr/bin/env python3
"""
Tile/Landscape Element Definitions for Tank Arena Map Editor

This module defines all tile types, their properties, and map-related constants.
Each tile represents an 8x8 pixel grid element in the map.
"""

# Tile size in pixels (each tile is 16x16 pixels)
TILE_SIZE = 16

# Available map sizes (in pixels)
# Each map is square: mapSize × mapSize pixels
MAP_SIZES = [512, 1024, 2048]

# Canvas scale factor for display (tile size in pixels)
CANVAS_SCALE = TILE_SIZE

# Tile type definitions
# Each tile has properties: name, color, accessible, destructible, blocks_bullet
TILE_TYPES = {
    0: {
        "name": "Soil",
        "color": "#8B4513",
        "accessible": True,
        "destructible": False,
        "blocks_bullet": False
    },
    1: {
        "name": "Water",
        "color": "#4169E1",
        "accessible": False,
        "destructible": False,
        "blocks_bullet": False
    },
    2: {
        "name": "Brick Wall",
        "color": "#CD5C5C",
        "accessible": False,
        "destructible": True,
        "blocks_bullet": False
    },
    3: {
        "name": "Grass",
        "color": "#228B22",
        "accessible": True,
        "destructible": False,
        "blocks_bullet": False
    },
    4: {
        "name": "Steel Wall",
        "color": "#708090",
        "accessible": False,
        "destructible": False,
        "blocks_bullet": True
    },
    5: {
        "name": "AI Tank Spawn",
        "color": "#FF0000",
        "accessible": True,
        "destructible": False,
        "blocks_bullet": False
    },
    6: {
        "name": "Player Tank Spawn",
        "color": "#00FF00",
        "accessible": True,
        "destructible": False,
        "blocks_bullet": False
    },
    7: {
        "name": "Player HQ",
        "color": "#FFD700",
        "accessible": False,
        "destructible": True,
        "blocks_bullet": False
    }
}

# Helper functions for tile properties
def is_accessible(tile_id):
    """Check if a tile is accessible (tanks can move onto it)"""
    if tile_id not in TILE_TYPES:
        return False
    return TILE_TYPES[tile_id]["accessible"]

def is_destructible(tile_id):
    """Check if a tile is destructible"""
    if tile_id not in TILE_TYPES:
        return False
    return TILE_TYPES[tile_id]["destructible"]

def blocks_bullet(tile_id):
    """Check if a tile blocks bullets"""
    if tile_id not in TILE_TYPES:
        return False
    return TILE_TYPES[tile_id]["blocks_bullet"]

def get_tile_color(tile_id):
    """Get the color of a tile"""
    if tile_id not in TILE_TYPES:
        return "#000000"  # Default to black for invalid tiles
    return TILE_TYPES[tile_id]["color"]

def get_tile_name(tile_id):
    """Get the name of a tile"""
    if tile_id not in TILE_TYPES:
        return "Unknown"
    return TILE_TYPES[tile_id]["name"]

def validate_tile_id(tile_id):
    """Validate that a tile ID is valid"""
    return tile_id in TILE_TYPES
