import asyncio
import contextlib
import json
import os
import random
import time
import re
import uuid
from pathlib import Path

from aiohttp import web, WSMsgType

ROOT_DIR = Path(__file__).resolve().parent.parent
GAME_BACKEND_PORT = int(os.getenv("GAME_BACKEND_PORT", "5051"))
TICK_MS = 33

TILE_TYPES = {
    "SOIL": 0,
    "WATER": 1,
    "BRICK_WALL": 2,
    "GRASS": 3,
    "STEEL_WALL": 4,
    "AI_SPAWN": 5,
    "PLAYER_SPAWN": 6,
    "PLAYER_HQ": 7,
}

TILE_PROPERTIES = {
    TILE_TYPES["SOIL"]: {"accessible": True, "destructible": False, "blocksBullet": False},
    TILE_TYPES["WATER"]: {"accessible": False, "destructible": False, "blocksBullet": False},
    TILE_TYPES["BRICK_WALL"]: {"accessible": False, "destructible": True, "blocksBullet": False},
    TILE_TYPES["GRASS"]: {"accessible": True, "destructible": False, "blocksBullet": False},
    TILE_TYPES["STEEL_WALL"]: {"accessible": False, "destructible": False, "blocksBullet": True},
    TILE_TYPES["AI_SPAWN"]: {"accessible": True, "destructible": False, "blocksBullet": False},
    TILE_TYPES["PLAYER_SPAWN"]: {"accessible": True, "destructible": False, "blocksBullet": False},
    TILE_TYPES["PLAYER_HQ"]: {"accessible": False, "destructible": True, "blocksBullet": False},
}

PLAYER_STATE_LABELS = ["id", "label", "role", "x", "y", "dirX", "dirY", "health", "maxHealth"]
BULLET_STATE_LABELS = ["id", "x", "y", "dirX", "dirY", "radius"]

sessions = {}
MAX_PLAYER_RESPAWNS = 1
ENEMY_SPAWN_INTERVAL_TICKS = int(os.getenv("ENEMY_SPAWN_INTERVAL_TICKS", "90"))
MAX_ENEMIES_ALIVE = int(os.getenv("MAX_ENEMIES_ALIVE", "4"))
AI_TANK_LABELS = [s.strip() for s in os.getenv("AI_TANK_LABELS", "normal_en").split(",") if s.strip()]
AI_AIM_THRESHOLD_PX = int(os.getenv("AI_AIM_THRESHOLD_PX", "8"))
RL_MODEL_BASE_KEY = os.getenv("RL_MODEL_BASE_KEY", "tank-ai-dqn")
RL_REWARD_DEFAULTS = {
    "hitPlayer": 2.0,
    "gotHit": -2.0,
    "destroyHQ": 5.0,
    "death": -5.0,
    "playerAim": 0.01,
    "hqAim": 0.01,
    "mapTileTouched": 0.02,
    "exploreStallPenalty": -0.001,
    "idlePenalty": -0.05,
    "directionChangePenalty": -0.05,
    "nonDestructiveShotPenalty": -0.03,
    "destructiveShot": 0.5,
    "collisionPenalty": -0.05,
    "hitAlly": -1.0,
    "stuckAreaPenalty": -0.02,
}
RL_REWARD_WEIGHTS = {
    **RL_REWARD_DEFAULTS,
    **(json.loads(os.getenv("RL_REWARD_JSON", "{}")) if os.getenv("RL_REWARD_JSON") else {}),
}
RL_IDLE_TICKS = int(os.getenv("RL_IDLE_TICKS", "20"))
RL_AIM_DOT = float(os.getenv("RL_AIM_DOT", "0.85"))
RL_DIR_CHANGE_COOLDOWN = int(os.getenv("RL_DIR_CHANGE_COOLDOWN", "6"))
RL_TRANSITE_GEN_INTERVAL = max(1, int(os.getenv("RL_TRANSITE_GEN_INTERVAL", "1")))
RL_STUCK_AREA_TICKS = int(os.getenv("RL_STUCK_AREA_TICKS", str(max(1, int(5000 / TICK_MS)))))
RL_EXPLORE_STALL_TICKS = int(os.getenv("RL_EXPLORE_STALL_TICKS", str(max(1, int(5000 / TICK_MS)))))


def load_reward_weights_from_config():
    config_path = ROOT_DIR / "DeepRL" / "rl-config.js"
    if not config_path.exists():
        return {}
    text = config_path.read_text(encoding="utf-8")
    in_block = False
    weights = {}
    for raw_line in text.splitlines():
        line = raw_line.split("//", 1)[0].strip()
        if not line:
            continue
        if not in_block and "rewardWeights" in line and "{" in line:
            in_block = True
            continue
        if in_block and "}" in line:
            break
        if in_block:
            match = re.match(r'^([A-Za-z0-9_]+)\s*:\s*([-0-9.]+)', line)
            if match:
                key = match.group(1)
                value = float(match.group(2))
                weights[key] = value
    return weights


def load_transite_interval_from_config():
    config_path = ROOT_DIR / "DeepRL" / "rl-config.js"
    if not config_path.exists():
        return None
    text = config_path.read_text(encoding="utf-8")
    for raw_line in text.splitlines():
        line = raw_line.split("//", 1)[0].strip()
        if not line:
            continue
        match = re.match(r'^transiteGenInterval\s*:\s*([0-9]+)', line)
        if match:
            try:
                return max(1, int(match.group(1)))
            except (TypeError, ValueError):
                return None
    return None


def refresh_reward_weights():
    global RL_REWARD_WEIGHTS, RL_TRANSITE_GEN_INTERVAL
    file_weights = load_reward_weights_from_config()
    RL_REWARD_WEIGHTS = {
        **RL_REWARD_DEFAULTS,
        **file_weights,
        **(json.loads(os.getenv("RL_REWARD_JSON", "{}")) if os.getenv("RL_REWARD_JSON") else {}),
    }
    file_interval = load_transite_interval_from_config()
    if file_interval is not None:
        RL_TRANSITE_GEN_INTERVAL = file_interval
    env_interval = os.getenv("RL_TRANSITE_GEN_INTERVAL")
    if env_interval:
        try:
            RL_TRANSITE_GEN_INTERVAL = max(1, int(env_interval))
        except (TypeError, ValueError):
            pass


def clamp(value, min_value, max_value):
    return min(max(value, min_value), max_value)


def set_ai_error(session, step, error):
    message = str(error) if isinstance(error, Exception) else str(error)
    session["aiErrorCount"] = session.get("aiErrorCount", 0) + 1
    session["lastAiError"] = {
        "step": step,
        "message": message,
        "tick": session.get("tick", 0),
    }


def log_ai_connection(session, message, details=None):
    logs = session.setdefault("aiConnectionLogs", [])
    entry = {
        "tick": session.get("tick", 0),
        "message": message,
    }
    if details is not None:
        entry["details"] = details
    logs.append(entry)
    if len(logs) > 120:
        logs.pop(0)
    if message in (
        "ai_ws_join",
        "ai_ws_replaced",
        "ai_backend_disconnected",
        "ai_socket_send_failed",
        "ws_disconnected",
    ):
        ts = time.time()
        ai_count = len(session.get("aiSockets", []))
        socket_count = len(session.get("sockets", []))
        detail_text = f" details={details}" if details is not None else ""
        print(
            f"[ai-conn] t={ts:.3f} tick={entry['tick']} msg={message}"
            f" aiSockets={ai_count} sockets={socket_count}{detail_text}"
        )


def update_ai_train_debug(session, debug_payload):
    if not isinstance(debug_payload, dict):
        return
    metrics = session.get("aiTrainDebug", {})
    if "rewardReasons" in debug_payload:
        pass
    for key in (
        "reward",
        "rewardReasons",
        "epsilon",
        "tdLoss",
        "qMean",
        "steps",
        "episodes",
        "state",
        "action",
        "modelPoolAvailable",
        "modelPoolTotal",
        "modelPoolInUse",
        "transitionsReceived",
        "actionsGenerated",
        "actionTick",
        "modelInstancesBrief",
        "rewardBatchCount",
        "rewardBatchSum",
        "trainStepsDelta",
        "episodeLog",
        "episodeLogTick",
        "perfTrainMs",
        "perfInferMs",
        "asyncSaveMs",
        "memModelBytes",
        "memTrainStateBytes",
        "memHistoryBytes",
        "gbeInputEvents",
        "aiMoveEvents",
        "aiMoveCounts",
        "aiMoveTick",
        "tickMs",
        "tickIntervalMs",
        "inputMs",
        "bulletsMs",
        "cooldownMs",
        "rewardMs",
        "broadcastMs",
        "aiSendMs",
        "playerSendMs",
        "aiSendAwaitMs",
        "loopWorkMs",
        "loopWaitMs",
        "loopIntervalMs",
    ):
        if key in debug_payload:
            metrics[key] = debug_payload.get(key)
    for key in ("buildState", "sentObserve", "workerAction", "returnedAction"):
        if key in debug_payload:
            metrics[key] = bool(debug_payload.get(key))
    session["aiTrainDebug"] = metrics


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_map_data(map_name):
    safe_name = map_name if map_name and map_name.endswith(".json") else "Stage03.json"
    clean_name = safe_name
    if clean_name.lower().startswith("maps/") or clean_name.lower().startswith("maps\\"):
        clean_name = clean_name[5:]
    map_path = ROOT_DIR / "maps" / clean_name
    data = read_json(map_path)
    return {
        "name": safe_name,
        "version": data.get("version"),
        "mapSize": data.get("mapSize"),
        "tileSize": data.get("tileSize"),
        "tiles": data.get("tiles"),
    }


def get_map_key(map_name):
    if not map_name:
        return "default"
    clean_name = map_name
    if clean_name.lower().startswith("maps/") or clean_name.lower().startswith("maps\\"):
        clean_name = clean_name[5:]
    if clean_name.lower().endswith(".json"):
        clean_name = clean_name[:-5]
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in clean_name).lower()


def load_tank_defs():
    tank_path = ROOT_DIR / "tanks" / "tanks.json"
    data = read_json(tank_path)
    defs = {}
    for item in data:
        try:
            hp = int(float(item.get("tank_hit_point")))
        except (TypeError, ValueError):
            hp = 1
        try:
            cooldown = int(float(item.get("cooldown")))
        except (TypeError, ValueError):
            cooldown = 0
        defs[item.get("tank_label")] = {
            **item,
            "tank_hit_point": hp,
            "cooldown": cooldown,
        }
    return defs


def get_spawn_points(map_data, spawn_type):
    spawns = []
    tiles = map_data["tiles"]
    for row in range(len(tiles)):
        for col in range(len(tiles[row])):
            if tiles[row][col] == spawn_type:
                spawns.append({"row": row, "col": col})
    return spawns


def get_player_hq(map_data):
    tiles = map_data["tiles"]
    for row in range(len(tiles)):
        for col in range(len(tiles[row])):
            if tiles[row][col] == TILE_TYPES["PLAYER_HQ"]:
                return {"row": row, "col": col}
    return None


def get_tile(map_data, row, col):
    tiles = map_data["tiles"]
    if row < 0 or col < 0 or row >= len(tiles) or col >= len(tiles):
        return None
    return tiles[row][col]


def is_accessible(map_data, row, col):
    tile_id = get_tile(map_data, row, col)
    if tile_id is None:
        return False
    props = TILE_PROPERTIES.get(tile_id)
    return props["accessible"] if props else False


def is_destructible(map_data, row, col):
    tile_id = get_tile(map_data, row, col)
    if tile_id is None:
        return False
    props = TILE_PROPERTIES.get(tile_id)
    return props["destructible"] if props else False


def count_accessible_or_destructible_tiles(map_data):
    tiles = map_data.get("tiles") if map_data else None
    if not tiles:
        return 0
    total = 0
    for row in tiles:
        for tile_id in row:
            props = TILE_PROPERTIES.get(tile_id)
            if not props:
                continue
            if props.get("accessible") or props.get("destructible"):
                total += 1
    return total


def blocks_bullet(map_data, row, col):
    tile_id = get_tile(map_data, row, col)
    if tile_id is None:
        return False
    props = TILE_PROPERTIES.get(tile_id)
    return props["blocksBullet"] if props else False


def get_bound_rect_at(tank, x, y):
    top_left_x = x - tank["width"] // 2
    top_left_y = y - tank["height"] // 2
    if not tank.get("boundMin") or not tank.get("boundMax"):
        return {"x": top_left_x, "y": top_left_y, "w": tank["width"], "h": tank["height"]}
    return {
        "x": top_left_x + tank["boundMin"]["x"],
        "y": top_left_y + tank["boundMin"]["y"],
        "w": max(0, tank["boundMax"]["x"] - tank["boundMin"]["x"] + 1),
        "h": max(0, tank["boundMax"]["y"] - tank["boundMin"]["y"] + 1),
    }


def get_tank_bound_rect_from_top_left(top_left_x, top_left_y, tank_def, size):
    if not tank_def or not tank_def.get("bound_min") or not tank_def.get("bound_max"):
        return {"x": top_left_x, "y": top_left_y, "w": size, "h": size}
    return {
        "x": top_left_x + tank_def["bound_min"]["x"],
        "y": top_left_y + tank_def["bound_min"]["y"],
        "w": max(0, tank_def["bound_max"]["x"] - tank_def["bound_min"]["x"] + 1),
        "h": max(0, tank_def["bound_max"]["y"] - tank_def["bound_min"]["y"] + 1),
    }


def is_tank_overlapping_rect(rect, tanks, ignore_id=None):
    for tank in tanks:
        if ignore_id and tank["id"] == ignore_id:
            continue
        other = get_bound_rect_at(tank, tank["x"], tank["y"])
        separated = (
            rect["x"] + rect["w"] <= other["x"]
            or rect["x"] >= other["x"] + other["w"]
            or rect["y"] + rect["h"] <= other["y"]
            or rect["y"] >= other["y"] + other["h"]
        )
        if not separated:
            return True
    return False


def is_rect_free(map_data, tanks, rect):
    if (
        rect["x"] < 0
        or rect["y"] < 0
        or rect["x"] + rect["w"] > map_data["mapSize"]
        or rect["y"] + rect["h"] > map_data["mapSize"]
    ):
        return False
    tile_size = map_data["tileSize"]
    tiles_per_side = len(map_data["tiles"])
    col_start = int(rect["x"] // tile_size)
    col_end = int((rect["x"] + rect["w"] - 1) // tile_size)
    row_start = int(rect["y"] // tile_size)
    row_end = int((rect["y"] + rect["h"] - 1) // tile_size)
    col_start = max(0, col_start)
    row_start = max(0, row_start)
    col_end = min(tiles_per_side - 1, col_end)
    row_end = min(tiles_per_side - 1, row_end)
    if col_start > col_end or row_start > row_end:
        return False
    for row in range(row_start, row_end + 1):
        for col in range(col_start, col_end + 1):
            if not is_accessible(map_data, row, col):
                return False
    return not is_tank_overlapping_rect(rect, tanks)


def get_spawn_center_for_tank(map_data, tanks, tank_def, spawn):
    size = 32
    tile_size = map_data["tileSize"]
    base_top_left_x = spawn["col"] * tile_size
    base_top_left_y = spawn["row"] * tile_size
    selected_rect = None
    for offset_row in range(-1, 2):
        if selected_rect:
            break
        for offset_col in range(-1, 2):
            test_top_left_x = (spawn["col"] + offset_col) * tile_size
            test_top_left_y = (spawn["row"] + offset_row) * tile_size
            rect = get_tank_bound_rect_from_top_left(test_top_left_x, test_top_left_y, tank_def, size)
            if is_rect_free(map_data, tanks, rect):
                selected_rect = rect
                break
    if not selected_rect:
        selected_rect = get_tank_bound_rect_from_top_left(base_top_left_x, base_top_left_y, tank_def, size)
    offset_x = tank_def.get("bound_min", {}).get("x", 0) if tank_def else 0
    offset_y = tank_def.get("bound_min", {}).get("y", 0) if tank_def else 0
    tank_top_left_x = selected_rect["x"] - offset_x
    tank_top_left_y = selected_rect["y"] - offset_y
    return {"x": tank_top_left_x + size // 2, "y": tank_top_left_y + size // 2}


def can_tank_occupy(map_data, tanks, tank, x, y):
    rect = get_bound_rect_at(tank, x, y)
    if (
        rect["x"] < 0
        or rect["y"] < 0
        or rect["x"] + rect["w"] > map_data["mapSize"]
        or rect["y"] + rect["h"] > map_data["mapSize"]
    ):
        return False
    tile_size = map_data["tileSize"]
    tiles_per_side = len(map_data["tiles"])
    col_start = max(0, int(rect["x"] // tile_size))
    col_end = min(tiles_per_side - 1, int((rect["x"] + rect["w"] - 1) // tile_size))
    row_start = max(0, int(rect["y"] // tile_size))
    row_end = min(tiles_per_side - 1, int((rect["y"] + rect["h"] - 1) // tile_size))
    if col_start > col_end or row_start > row_end:
        return False
    for row in range(row_start, row_end + 1):
        for col in range(col_start, col_end + 1):
            if not is_accessible(map_data, row, col):
                return False
    return not is_tank_overlapping_rect(rect, tanks, tank["id"])


def get_rect_center(rect):
    return {"x": rect["x"] + rect["w"] // 2, "y": rect["y"] + rect["h"] // 2}


def compute_distance(x1, y1, x2, y2):
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


def compute_aim_dot(dir_x, dir_y, dx, dy):
    mag = (dx * dx + dy * dy) ** 0.5
    if mag == 0:
        return 0
    return (dir_x * dx + dir_y * dy) / mag


def get_hq_center(session):
    hq = session.get("playerHQ")
    map_data = session.get("mapData") or {}
    if not hq or not map_data:
        return None
    tile_size = map_data.get("tileSize", 0)
    return {"x": hq["col"] * tile_size + tile_size // 2, "y": hq["row"] * tile_size + tile_size // 2}


def is_bullet_path_blocked(map_data, x1, y1, x2, y2):
    start = {"col": int(x1 // map_data["tileSize"]), "row": int(y1 // map_data["tileSize"])}
    end = {"col": int(x2 // map_data["tileSize"]), "row": int(y2 // map_data["tileSize"])}
    dx = abs(end["col"] - start["col"])
    dy = abs(end["row"] - start["row"])
    sx = 1 if start["col"] < end["col"] else -1
    sy = 1 if start["row"] < end["row"] else -1
    err = dx - dy
    x = start["col"]
    y = start["row"]
    while True:
        if blocks_bullet(map_data, y, x):
            return True
        if x == end["col"] and y == end["row"]:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x += sx
        if e2 < dx:
            err += dx
            y += sy
    return False


def has_line_of_sight(map_data, from_x, from_y, to_x, to_y):
    if not map_data:
        return False
    return not is_bullet_path_blocked(map_data, from_x, from_y, to_x, to_y)


def is_aim_blocked_tile(map_data, row, col):
    tile_id = get_tile(map_data, row, col)
    if tile_id is None:
        return True
    props = TILE_PROPERTIES.get(tile_id) or {}
    return bool(props.get("blocksBullet")) and not bool(props.get("destructible"))


def ray_reaches_rect(map_data, start_x, start_y, dir_x, dir_y, target_rect):
    if not map_data or not target_rect:
        return False
    if dir_x == 0 and dir_y == 0:
        return False
    if dir_x != 0 and dir_y != 0:
        return False
    tile_size = map_data["tileSize"]
    tiles_per_side = len(map_data["tiles"])
    if dir_x != 0:
        if start_y < target_rect["y"] or start_y > (target_rect["y"] + target_rect["h"]):
            return False
        if dir_x > 0:
            target_x = target_rect["x"]
            if target_x < start_x:
                return False
        else:
            target_x = target_rect["x"] + target_rect["w"]
            if target_x > start_x:
                return False
        row = int(start_y // tile_size)
        start_col = int(start_x // tile_size)
        target_col = int(target_x // tile_size)
        step = 1 if dir_x > 0 else -1
        col = start_col
        while 0 <= col < tiles_per_side:
            if is_aim_blocked_tile(map_data, row, col):
                return False
            if col == target_col:
                return True
            col += step
    else:
        if start_x < target_rect["x"] or start_x > (target_rect["x"] + target_rect["w"]):
            return False
        if dir_y > 0:
            target_y = target_rect["y"]
            if target_y < start_y:
                return False
        else:
            target_y = target_rect["y"] + target_rect["h"]
            if target_y > start_y:
                return False
        col = int(start_x // tile_size)
        start_row = int(start_y // tile_size)
        target_row = int(target_y // tile_size)
        step = 1 if dir_y > 0 else -1
        row = start_row
        while 0 <= row < tiles_per_side:
            if is_aim_blocked_tile(map_data, row, col):
                return False
            if row == target_row:
                return True
            row += step
    return False

def step_bullet(map_data, bullet, tanks):
    start_x = bullet["x"]
    start_y = bullet["y"]
    end_x = bullet["x"] + bullet["dirX"] * bullet["speed"]
    end_y = bullet["y"] + bullet["dirY"] * bullet["speed"]
    dx = end_x - start_x
    dy = end_y - start_y
    steps = max(abs(dx), abs(dy))
    tile_size = map_data["tileSize"]
    result = {
        "hit": False,
        "mapChanged": False,
        "hqDestroyed": False,
        "hitTank": None,
        "hitPoint": None,
        "destroyedTank": None,
        "blocked": False,
        "outOfBounds": False,
        "changedTiles": [],
    }
    map_size = int(map_data["mapSize"])

    def get_tile_hit_fx(row, col, pos_x, pos_y):
        tile_left = col * tile_size
        tile_right = tile_left + tile_size
        tile_top = row * tile_size
        tile_bottom = tile_top + tile_size
        fx_x = pos_x
        fx_y = pos_y
        if bullet["dirX"] > 0:
            fx_x = tile_left
        elif bullet["dirX"] < 0:
            fx_x = tile_right
        if bullet["dirY"] > 0:
            fx_y = tile_top
        elif bullet["dirY"] < 0:
            fx_y = tile_bottom
        if bullet["dirX"] != 0 and bullet["dirY"] == 0:
            fx_y = clamp(fx_y, tile_top, tile_bottom)
        elif bullet["dirY"] != 0 and bullet["dirX"] == 0:
            fx_x = clamp(fx_x, tile_left, tile_right)
        return {"x": fx_x, "y": fx_y}

    def check_at(pos_x, pos_y):
        r = bullet["radius"]
        min_col = int((pos_x - r) // tile_size)
        max_col = int((pos_x + r) // tile_size)
        min_row = int((pos_y - r) // tile_size)
        max_row = int((pos_y + r) // tile_size)
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                tile_id = get_tile(map_data, row, col)
                if is_destructible(map_data, row, col):
                    if tile_id == TILE_TYPES["PLAYER_HQ"]:
                        result["hqDestroyed"] = True
                    map_data["tiles"][row][col] = TILE_TYPES["SOIL"]
                    result["changedTiles"].append({"row": row, "col": col, "tileId": TILE_TYPES["SOIL"]})
                    result["mapChanged"] = True
                    fx_pos = get_tile_hit_fx(row, col, pos_x, pos_y)
                    result["hitPoint"] = fx_pos
                    result["hit"] = True
                    return True
                if blocks_bullet(map_data, row, col):
                    fx_pos = get_tile_hit_fx(row, col, pos_x, pos_y)
                    result["hitPoint"] = fx_pos
                    result["hit"] = True
                    result["blocked"] = True
                    return True
        for tank in tanks:
            if tank["id"] == bullet["ownerId"]:
                continue
            rect = get_bound_rect_at(tank, tank["x"], tank["y"])
            clamped_x = clamp(pos_x, rect["x"], rect["x"] + rect["w"])
            clamped_y = clamp(pos_y, rect["y"], rect["y"] + rect["h"])
            ddx = pos_x - clamped_x
            ddy = pos_y - clamped_y
            if ddx * ddx + ddy * ddy < bullet["radius"] * bullet["radius"]:
                tank["health"] = max(0, tank["health"] - 1)
                result["hitTank"] = tank
                result["hitPoint"] = {"x": clamped_x, "y": clamped_y}
                if tank["health"] <= 0:
                    result["destroyedTank"] = tank
                result["hit"] = True
                return True
        return False

    if steps == 0:
        if start_x < 0 or start_y < 0 or start_x >= map_size or start_y >= map_size:
            result["hit"] = True
            result["outOfBounds"] = True
            return result
        check_at(start_x, start_y)
        return result if result["hit"] else None
    x = start_x
    y = start_y
    step_x = 0 if dx == 0 else (1 if dx > 0 else -1)
    step_y = 0 if dy == 0 else (1 if dy > 0 else -1)
    for _ in range(steps + 1):
        if x < 0 or y < 0 or x >= map_size or y >= map_size:
            result["hit"] = True
            result["outOfBounds"] = True
            return result
        if check_at(x, y):
            return result
        x += step_x
        y += step_y
    bullet["x"] = end_x
    bullet["y"] = end_y
    return None


def predict_bullet_result(map_data, bullet, tanks):
    if not map_data:
        return {"type": "none"}
    dir_x = bullet.get("dirX", 0)
    dir_y = bullet.get("dirY", 0)
    if dir_x == 0 and dir_y == 0:
        return {"type": "none"}
    start_x = bullet["x"]
    start_y = bullet["y"]
    map_size = int(map_data["mapSize"])
    tile_size = map_data["tileSize"]

    end_x = start_x
    end_y = start_y
    if dir_x > 0:
        end_x = map_size - 1
    elif dir_x < 0:
        end_x = 0
    if dir_y > 0:
        end_y = map_size - 1
    elif dir_y < 0:
        end_y = 0

    dx = end_x - start_x
    dy = end_y - start_y
    steps = max(abs(dx), abs(dy))
    step_x = 0 if dx == 0 else (1 if dx > 0 else -1)
    step_y = 0 if dy == 0 else (1 if dy > 0 else -1)

    def check_at(pos_x, pos_y):
        r = bullet["radius"]
        min_col = int((pos_x - r) // tile_size)
        max_col = int((pos_x + r) // tile_size)
        min_row = int((pos_y - r) // tile_size)
        max_row = int((pos_y + r) // tile_size)
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                tile_id = get_tile(map_data, row, col)
                if tile_id == TILE_TYPES["PLAYER_HQ"]:
                    return {"type": "hq"}
                if is_destructible(map_data, row, col):
                    return {"type": "tile_destructible"}
                if blocks_bullet(map_data, row, col):
                    return {"type": "tile_non_destructible"}
        for tank in tanks:
            if tank["id"] == bullet["ownerId"]:
                continue
            rect = get_bound_rect_at(tank, tank["x"], tank["y"])
            clamped_x = clamp(pos_x, rect["x"], rect["x"] + rect["w"])
            clamped_y = clamp(pos_y, rect["y"], rect["y"] + rect["h"])
            ddx = pos_x - clamped_x
            ddy = pos_y - clamped_y
            if ddx * ddx + ddy * ddy < bullet["radius"] * bullet["radius"]:
                if tank.get("role") == "player":
                    return {"type": "player"}
                return {"type": "ai", "targetId": tank["id"]}
        return None

    if steps == 0:
        if start_x < 0 or start_y < 0 or start_x >= map_size or start_y >= map_size:
            return {"type": "none"}
        result = check_at(start_x, start_y)
        return result if result else {"type": "none"}
    x = start_x
    y = start_y
    for _ in range(steps + 1):
        if x < 0 or y < 0 or x >= map_size or y >= map_size:
            break
        result = check_at(x, y)
        if result:
            return result
        x += step_x
        y += step_y
    return {"type": "none"}


def create_tank(tank_id, label, tank_def, center):
    size = 32
    return {
        "id": tank_id,
        "label": label,
        "x": center["x"],
        "y": center["y"],
        "dirX": 0,
        "dirY": -1,
        "width": size,
        "height": size,
        "boundMin": tank_def.get("bound_min") if tank_def else None,
        "boundMax": tank_def.get("bound_max") if tank_def else None,
        "speed": int(tank_def.get("speed") or 2),
        "shellSize": int(tank_def.get("shell_size") or 2),
        "shellSpeed": int(tank_def.get("shell_speed") or 4),
        "cooldown": int(tank_def.get("cooldown") or 0),
        "shootCooldown": 0,
        "health": tank_def.get("tank_hit_point") if tank_def else 1,
        "maxHealth": tank_def.get("tank_hit_point") if tank_def else 1,
    }


def to_base36(value):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    num = int(value)
    if num <= 0:
        return "0"
    out = []
    while num > 0:
        num, rem = divmod(num, 36)
        out.append(digits[rem])
    return "".join(reversed(out))


def ensure_short_id(session, full_id):
    if not full_id:
        return full_id
    full_to_short = session.setdefault("idMapFullToShort", {})
    short_to_full = session.setdefault("idMapShortToFull", {})
    if full_id in full_to_short:
        return full_to_short[full_id]
    next_short = int(session.get("nextShortId", 1))
    short_id = to_base36(next_short)
    while short_id in short_to_full:
        next_short += 1
        short_id = to_base36(next_short)
    session["nextShortId"] = next_short + 1
    full_to_short[full_id] = short_id
    short_to_full[short_id] = full_id
    return short_id


def to_network_id(session, maybe_id):
    if maybe_id is None:
        return None
    if not isinstance(maybe_id, str):
        maybe_id = str(maybe_id)
    if not maybe_id:
        return maybe_id
    return ensure_short_id(session, maybe_id)


def resolve_network_id(session, maybe_id):
    if maybe_id is None:
        return None
    if not isinstance(maybe_id, str):
        maybe_id = str(maybe_id)
    if not maybe_id:
        return maybe_id
    if maybe_id in session.get("idMapShortToFull", {}):
        return session["idMapShortToFull"][maybe_id]
    return maybe_id


def serialize_ai_input_meta(session, value):
    if not isinstance(value, dict):
        return value
    out = dict(value)
    if "tankId" in out:
        out["tankId"] = to_network_id(session, out.get("tankId"))
    return out


def serialize_event_for_network(session, event):
    if not isinstance(event, dict):
        return event
    out = dict(event)
    if "tankId" in out:
        out["tankId"] = to_network_id(session, out.get("tankId"))
    if "ownerId" in out:
        out["ownerId"] = to_network_id(session, out.get("ownerId"))
    return out


def init_inference_episode(tick):
    return {
        "startTick": tick,
        "steps": 0,
        "rewardSum": 0.0,
        "shots": 0,
        "predHitPlayer": 0,
        "predHitHQ": 0,
        "predHitAlly": 0,
        "damageDealt": 0,
        "damageTaken": 0,
        "win": None,
        "timeToWin": None,
        "closed": False,
    }


def update_inference_metrics(session, ai_rewards, bullet_events, predicted_shots):
    current = session.get("inferenceCurrent")
    if not isinstance(current, dict):
        current = init_inference_episode(session.get("tick", 0))
        session["inferenceCurrent"] = current
    if current.get("closed") and not session.get("gameOver"):
        current = init_inference_episode(session.get("tick", 0))
        session["inferenceCurrent"] = current

    current["steps"] += 1
    if isinstance(ai_rewards, list):
        current["rewardSum"] += sum(float(item.get("reward", 0)) for item in ai_rewards)

    if isinstance(predicted_shots, list):
        for shot in predicted_shots:
            if shot.get("ownerRole") != "ai":
                continue
            current["shots"] += 1
            result_type = shot.get("resultType")
            if result_type == "player":
                current["predHitPlayer"] += 1
            elif result_type == "hq":
                current["predHitHQ"] += 1
            elif result_type == "ai":
                current["predHitAlly"] += 1

    if isinstance(bullet_events, list):
        for event in bullet_events:
            hit_tank = event.get("hitTank")
            if not hit_tank:
                continue
            owner_id = event.get("ownerId")
            owner = next((t for t in session["players"] if t.get("id") == owner_id), None)
            owner_role = owner.get("role") if owner else None
            if hit_tank.get("role") == "player" and owner_role == "ai":
                current["damageDealt"] += 1
            elif hit_tank.get("role") == "ai" and owner_role != "ai":
                current["damageTaken"] += 1

    if session.get("gameOver") and not current.get("closed"):
        reason = session.get("gameOverReason")
        win = reason in ("player_destroyed", "hq_destroyed")
        current["win"] = win
        current["timeToWin"] = current["steps"] if win else None
        current["closed"] = True
        history = session.setdefault("inferenceHistory", [])
        history.append(current)
        if len(history) > 10:
            history.pop(0)


def build_inference_summary(session):
    history = session.get("inferenceHistory") or []
    if not history:
        current = session.get("inferenceCurrent")
        if isinstance(current, dict) and current.get("steps", 0) > 0:
            history = [current]
    if not history:
        return None
    count = len(history)
    wins = sum(1 for item in history if item.get("win"))
    reward_avg = sum(item.get("rewardSum", 0.0) for item in history) / count
    steps_avg = sum(item.get("steps", 0) for item in history) / count
    damage_dealt_avg = sum(item.get("damageDealt", 0) for item in history) / count
    damage_taken_avg = sum(item.get("damageTaken", 0) for item in history) / count
    shots = sum(item.get("shots", 0) for item in history)
    hit_player = sum(item.get("predHitPlayer", 0) for item in history)
    hit_hq = sum(item.get("predHitHQ", 0) for item in history)
    hit_rate = (hit_player / shots) if shots > 0 else 0.0
    hq_rate = (hit_hq / shots) if shots > 0 else 0.0
    time_to_win = [item.get("timeToWin") for item in history if item.get("timeToWin") is not None]
    time_to_win_avg = (sum(time_to_win) / len(time_to_win)) if time_to_win else None
    return {
        "episodeCount": count,
        "avgReward": reward_avg,
        "avgSteps": steps_avg,
        "winRate": wins / count,
        "avgDamageDealt": damage_dealt_avg,
        "avgDamageTaken": damage_taken_avg,
        "hitRate": hit_rate,
        "hqRate": hq_rate,
        "avgTimeToWin": time_to_win_avg,
    }


def serialize_connection_logs(session, logs):
    out = []
    for entry in logs:
        if not isinstance(entry, dict):
            continue
        next_entry = dict(entry)
        details = next_entry.get("details")
        if isinstance(details, dict):
            next_details = dict(details)
            if "tankId" in next_details:
                next_details["tankId"] = to_network_id(session, next_details.get("tankId"))
            if "playerId" in next_details:
                next_details["playerId"] = to_network_id(session, next_details.get("playerId"))
            next_entry["details"] = next_details
        out.append(next_entry)
    return out


def serialize_ai_move_map(session, value):
    if not isinstance(value, dict):
        return {}
    out = {}
    for key, item in value.items():
        raw_key = str(key)
        if "|" in raw_key:
            full_id, rest = raw_key.split("|", 1)
            mapped = to_network_id(session, full_id)
            next_key = f"{mapped}|{rest}"
        else:
            next_key = to_network_id(session, raw_key)
        out[next_key] = item
    return out


def values_from_labels(item, labels):
    return [item.get(key) for key in labels]


def pack_debug_for_network(session, channel_key, values, include_labels=False):
    labels_key = f"{channel_key}Labels"
    sent_key = f"{channel_key}LabelsSent"
    labels = session.get(labels_key)
    if not isinstance(labels, list) or not labels:
        labels = list(values.keys())
        session[labels_key] = labels
    missing = [key for key in values.keys() if key not in labels]
    if missing:
        labels.extend(missing)
        session[labels_key] = labels
        session[sent_key] = False
    should_include_labels = include_labels or not bool(session.get(sent_key))
    payload = {
        "values": [values.get(key) for key in labels],
    }
    if should_include_labels:
        payload["labels"] = labels
        session[sent_key] = True
    return payload


def create_session(map_name, max_enemies_alive=None):
    refresh_reward_weights()
    map_data = load_map_data(map_name)
    tank_defs = load_tank_defs()
    player_spawns = get_spawn_points(map_data, TILE_TYPES["PLAYER_SPAWN"])
    ai_spawns = get_spawn_points(map_data, TILE_TYPES["AI_SPAWN"])
    map_key = get_map_key(map_data.get("name"))
    session_id = str(uuid.uuid4())
    seed = random.randint(0, 2**31 - 1)
    bounds = map_data["mapSize"]
    center = bounds // 2
    hq = get_player_hq(map_data)
    try:
        cap = int(max_enemies_alive) if max_enemies_alive is not None else MAX_ENEMIES_ALIVE
    except (TypeError, ValueError):
        cap = MAX_ENEMIES_ALIVE
    cap = max(0, cap)
    max_enemy_count = min(len(ai_spawns), cap)
    session = {
        "id": session_id,
        "mapKey": map_key,
        "modelKey": f"{RL_MODEL_BASE_KEY}-{map_key}",
        "mapData": map_data,
        "tankDefs": tank_defs,
        "playerSpawns": player_spawns,
        "aiSpawns": ai_spawns,
        "playerHQ": hq,
        "playerCount": 0,
        "playerMeta": {},
        "players": [],
        "bullets": [],
        "aiInputs": [],
        "aiInputQueues": {},
        "lastAiInputByTank": {},
        "playerInputs": [],
        "events": [
            {"type": "fx", "name": "game_start", "x": center, "y": center},
        ],
        "tick": 0,
        "sockets": set(),
        "aiSockets": set(),
        "wsMeta": {},
        "netBytesSent": 0,
        "netBytesSentTick": 0,
        "netBreakdown": {
            "stateBytesTotal": 0,
            "stateBytesTick": 0,
            "transitionBytesTotal": 0,
            "transitionBytesTick": 0,
            "playerInputWsBytesTotal": 0,
            "playerInputWsBytesTick": 0,
            "aiInputWsBytesTotal": 0,
            "aiInputWsBytesTick": 0,
            "aiInputHttpBytesTotal": 0,
            "aiInputHttpBytesTick": 0,
            "joinWsBytesTotal": 0,
            "joinWsBytesTick": 0,
            "debugToggleWsBytesTotal": 0,
            "debugToggleWsBytesTick": 0,
            "otherWsInBytesTotal": 0,
            "otherWsInBytesTick": 0,
        },
        "lastState": None,
        "lastTransitionState": None,
        "aiRewardAccum": {},
        "inputCountTick": 0,
        "inputCountTotal": 0,
        "aiInputRecvTotal": 0,
        "aiInputAppliedTotal": 0,
        "aiInputEventTotal": 0,
        "lastAiInputReceived": None,
        "lastAiInputApplied": None,
        "aiErrorCount": 0,
        "lastAiError": None,
        "aiTrainDebug": {
            "state": None,
            "action": None,
            "reward": None,
            "epsilon": None,
            "tdLoss": None,
            "qMean": None,
            "steps": 0,
            "episodes": None,
            "buildState": False,
            "sentObserve": False,
            "workerAction": False,
            "returnedAction": False,
        },
        "mapDirty": False,
        "mapTileUpdates": [],
        "enemiesDestroyed": 0,
        "gameOver": False,
        "gameOverReason": None,
        "gameOverFx": "destroy_hq",
        "removeAtTick": None,
        "enemySpawnTimerTicks": 0,
        "enemySpawnIntervalTicks": ENEMY_SPAWN_INTERVAL_TICKS,
        "maxEnemyCount": max_enemy_count,
        "transitionInterval": max(1, int(RL_TRANSITE_GEN_INTERVAL)),
        "totalAccessibleTiles": count_accessible_or_destructible_tiles(map_data),
        "rng": random.Random(seed),
        "aiRuntime": {},
        "aiBackendDisconnectedLogged": False,
        "aiConnectionLogs": [],
        "aiDebugLabels": None,
        "aiDebugLabelsSent": False,
        "gbeDebugLabels": None,
        "gbeDebugLabelsSent": False,
        "idMapFullToShort": {},
        "idMapShortToFull": {},
        "nextShortId": 1,
        "inferenceCurrent": init_inference_episode(0),
        "inferenceHistory": [],
    }
    log_ai_connection(session, "session_created", {"sessionId": session_id, "maxEnemyCount": max_enemy_count})
    sessions[session_id] = session
    return session


def assign_player(session, label="normal_pl"):
    if session["playerCount"] >= len(session["playerSpawns"]):
        return None
    spawn_index = session["playerCount"]
    spawn = session["playerSpawns"][spawn_index]
    tank_def = session["tankDefs"].get(label)
    if not tank_def:
        return None
    tank_id = str(uuid.uuid4())
    center = get_spawn_center_for_tank(session["mapData"], session["players"], tank_def, spawn)
    tank = create_tank(tank_id, label, tank_def, center)
    tank["role"] = "player"
    session["players"].append(tank)
    session["playerMeta"][tank_id] = {
        "respawnsRemaining": MAX_PLAYER_RESPAWNS,
        "spawnIndex": spawn_index,
    }
    session["playerCount"] += 1
    return tank


def count_alive_ai_tanks(session):
    return sum(1 for tank in session["players"] if tank.get("role") == "ai" and tank.get("health", 0) > 0)


def get_alive_player_tanks(session):
    return [tank for tank in session["players"] if tank.get("role") == "player" and tank.get("health", 0) > 0]


def get_nearest_player_tank(session, ai_tank):
    players = get_alive_player_tanks(session)
    if not players:
        return None
    best = players[0]
    best_dist2 = (best["x"] - ai_tank["x"]) ** 2 + (best["y"] - ai_tank["y"]) ** 2
    for player in players[1:]:
        dist2 = (player["x"] - ai_tank["x"]) ** 2 + (player["y"] - ai_tank["y"]) ** 2
        if dist2 < best_dist2:
            best = player
            best_dist2 = dist2
    return best


def spawn_enemy(session):
    try:
        if session.get("gameOver"):
            return False
        ai_spawns = session.get("aiSpawns") or []
        if not ai_spawns:
            return False
        max_enemy_count = session.get("maxEnemyCount", 0)
        if max_enemy_count <= 0:
            return False
        alive_ai = count_alive_ai_tanks(session)
        if alive_ai >= max_enemy_count:
            return False

        label_list = AI_TANK_LABELS if AI_TANK_LABELS else ["normal_en"]
        rng = session.get("rng") or random
        tank_label = label_list[rng.randrange(len(label_list))]
        tank_def = session["tankDefs"].get(tank_label)
        if not tank_def:
            tank_def = session["tankDefs"].get("normal_en")
            tank_label = "normal_en"
        if not tank_def:
            set_ai_error(session, "ai_init", "Missing AI tank definition")
            return False

        spawn_index = rng.randrange(len(ai_spawns))
        for i in range(len(ai_spawns)):
            index = (spawn_index + i) % len(ai_spawns)
            spawn = ai_spawns[index]
            spawn_center = get_spawn_center_for_tank(session["mapData"], session["players"], tank_def, spawn)
            tank_id = str(uuid.uuid4())
            tank = create_tank(tank_id, tank_label, tank_def, spawn_center)
            tank["role"] = "ai"
            tank["spawnTick"] = session.get("tick", 0)
            if can_tank_occupy(session["mapData"], session["players"], tank, tank["x"], tank["y"]):
                session["players"].append(tank)
                session["aiRuntime"][tank_id] = {
                    "idleTicks": 0,
                    "lastMove": None,
                    "lastDidMove": False,
                    "visitedTiles": set(),
                    "lastVisitedCount": 0,
                    "lastVisitedTick": session.get("tick", 0),
                }
                session["events"].append({
                    "type": "ai_spawn",
                    "tankId": tank_id,
                    "label": tank_label,
                    "x": tank["x"],
                    "y": tank["y"],
                })
                return True
        return False
    except Exception as error:
        set_ai_error(session, "ai_spawn", error)
        return False


def handle_input_queue(session):
    if session.get("gameOver"):
        session["playerInputs"].clear()
        session["aiInputs"].clear()
        return
    inputs = session["playerInputs"][:]
    session["playerInputs"].clear()
    ai_inputs = session["aiInputs"][:]
    session["aiInputs"].clear()
    ai_move_events = {}
    ai_move_counts = {}
    ai_queues = session.get("aiInputQueues")
    if not isinstance(ai_queues, dict):
        ai_queues = {}
        session["aiInputQueues"] = ai_queues
    last_ai_by_tank = session.get("lastAiInputByTank")
    if not isinstance(last_ai_by_tank, dict):
        last_ai_by_tank = {}
        session["lastAiInputByTank"] = last_ai_by_tank
    for event in ai_inputs:
        if event.get("source") != "ai":
            continue
        session["aiInputEventTotal"] = session.get("aiInputEventTotal", 0) + 1
        tank_id = event.get("tankId")
        if not tank_id:
            continue
        tank = next((t for t in session["players"] if t.get("id") == tank_id), None)
        tank_label = tank.get("label") if tank else None
        move = event.get("move")
        fire = bool(event.get("fire"))
        if move and fire:
            label = f"{move}+fire"
        elif move:
            label = move
        elif fire:
            label = "fire"
        else:
            label = "idle"
        ai_queues.setdefault(tank_id, []).append(event)
        key = f"{tank_id}|{tank_label}" if tank_label else tank_id
        ai_move_events.setdefault(key, []).append(label)
    ai_inputs_for_tick = []
    tanks = session["players"]
    ai_tanks = [t for t in tanks if t.get("role") == "ai" and t.get("health", 0) > 0]
    for tank in ai_tanks:
        tank_id = tank.get("id")
        queue = ai_queues.get(tank_id, [])
        if queue:
            if len(queue) > 3:
                tank_label = tank.get("label") if tank else "--"
                queued_count = len(queue)
                print(
                    f"[GBE WARNING][{session.get('id','--')}] tick={session.get('tick',0)} "
                    f"aiInputQueue overflow tank={tank_id} label={tank_label} queued={queued_count} consumed=1"
                )
            event = queue.pop(0)
            last_ai_by_tank[tank_id] = {
                "tankId": tank_id,
                "move": event.get("move"),
                "fire": bool(event.get("fire")),
                "source": "ai",
            }
            ai_inputs_for_tick.append(event)
        else:
            last_event = last_ai_by_tank.get(tank_id)
            if last_event:
                ai_inputs_for_tick.append(
                    {
                        "tankId": tank_id,
                        "move": last_event.get("move"),
                        "fire": bool(last_event.get("fire")),
                        "source": "ai",
                    }
                )
    for tank_id, queue in ai_queues.items():
        if not queue:
            continue
        tank = next((t for t in session["players"] if t.get("id") == tank_id), None)
        tank_label = tank.get("label") if tank else None
        key = f"{tank_id}|{tank_label}" if tank_label else tank_id
        ai_move_counts[key] = len(queue)
    if ai_move_events or ai_move_counts:
        metrics = session.get("aiTrainDebug", {})
        metrics["aiMoveEvents"] = ai_move_events
        metrics["aiMoveCounts"] = ai_move_counts
        metrics["aiMoveTick"] = session.get("tick", 0)
        session["aiTrainDebug"] = metrics
    all_inputs = inputs + ai_inputs_for_tick
    for event in all_inputs:
        try:
            tank = next((t for t in tanks if t["id"] == event.get("tankId")), None)
            if not tank:
                continue
            if event.get("source") == "ai":
                session["aiInputAppliedTotal"] += 1
                session["lastAiInputApplied"] = {
                    "tankId": event.get("tankId"),
                    "move": event.get("move"),
                    "fire": bool(event.get("fire")),
                    "tick": session.get("tick", 0),
                    "source": "ai",
                }
                metrics = session.get("aiTrainDebug", {})
                metrics["workerAction"] = True
                metrics["returnedAction"] = True
                metrics["action"] = event.get("move") or ("fire" if event.get("fire") else "idle")
                session["aiTrainDebug"] = metrics
            move = event.get("move")
            did_move = False
            if move == "move_up":
                tank["dirX"] = 0
                tank["dirY"] = -1
            elif move == "move_down":
                tank["dirX"] = 0
                tank["dirY"] = 1
            elif move == "move_left":
                tank["dirX"] = -1
                tank["dirY"] = 0
            elif move == "move_right":
                tank["dirX"] = 1
                tank["dirY"] = 0
            if move:
                before_x = tank["x"]
                before_y = tank["y"]
                next_x = tank["x"] + tank["dirX"] * tank["speed"]
                next_y = tank["y"] + tank["dirY"] * tank["speed"]
                if can_tank_occupy(session["mapData"], tanks, tank, next_x, tank["y"]):
                    tank["x"] = next_x
                if can_tank_occupy(session["mapData"], tanks, tank, tank["x"], next_y):
                    tank["y"] = next_y
                did_move = (tank["x"] != before_x) or (tank["y"] != before_y)
                if event.get("source") == "ai" and not did_move:
                    runtime = session.setdefault("aiRuntime", {})
                    meta = runtime.get(tank["id"]) or {"idleTicks": 0}
                    meta["blockedMove"] = True
                    runtime[tank["id"]] = meta
            if event.get("source") == "ai":
                runtime = session.setdefault("aiRuntime", {})
                meta = runtime.get(tank["id"]) or {"idleTicks": 0, "lastMove": None, "lastDidMove": False}
                meta["lastMove"] = move
                meta["lastDidMove"] = did_move
                meta["idleTicks"] = 0 if did_move else int(meta.get("idleTicks", 0)) + 1
                runtime[tank["id"]] = meta
            if event.get("fire") and tank["shootCooldown"] <= 0:
                tank["shootCooldown"] = tank["cooldown"]
                bound_rect = get_bound_rect_at(tank, tank["x"], tank["y"])
                bullet_x = bound_rect["x"] + bound_rect["w"] // 2
                bullet_y = bound_rect["y"] + bound_rect["h"] // 2
                bullet = {
                    "id": str(uuid.uuid4()),
                    "x": bullet_x,
                    "y": bullet_y,
                    "dirX": tank["dirX"],
                    "dirY": tank["dirY"],
                    "speed": tank["shellSpeed"],
                    "radius": tank["shellSize"],
                    "ownerId": tank["id"],
                }
                prediction = predict_bullet_result(session["mapData"], bullet, tanks)
                bullet["predictedResult"] = prediction
                session["bullets"].append(bullet)
                predicted_shots = session.setdefault("predictedShots", [])
                predicted_shots.append(
                    {
                        "ownerId": tank["id"],
                        "ownerRole": tank.get("role"),
                        "resultType": prediction.get("type"),
                        "targetId": prediction.get("targetId"),
                    }
                )
                session["events"].append(
                    {"type": "fx", "name": "fire", "x": tank["x"], "y": tank["y"], "tankId": tank["id"]}
                )
        except Exception as error:
            if event.get("source") == "ai":
                set_ai_error(session, "ai_input_apply", error)


def update_bullets(session):
    remaining = []
    events = []
    for bullet in session["bullets"]:
        result = step_bullet(session["mapData"], bullet, session["players"])
        if not result:
            remaining.append(bullet)
            continue
        if result.get("outOfBounds"):
            continue
        if result.get("mapChanged"):
            session["mapDirty"] = True
            updates = session.setdefault("mapTileUpdates", [])
            for changed in result.get("changedTiles", []):
                row = changed.get("row")
                col = changed.get("col")
                tile_id = changed.get("tileId")
                exists = any((u.get("row") == row and u.get("col") == col) for u in updates)
                if not exists:
                    updates.append({"row": row, "col": col, "tileId": tile_id})
        hit_point = result.get("hitPoint")
        if hit_point and not result.get("hitTank"):
            session["events"].append(
                {"type": "fx", "name": "hit", "x": hit_point["x"], "y": hit_point["y"], "tankId": bullet.get("ownerId")}
            )
        if result.get("hitTank") and hit_point:
            hit_tank = result.get("hitTank")
            session["events"].append(
                {"type": "fx", "name": "hit_tank", "x": hit_point["x"], "y": hit_point["y"], "tankId": hit_tank["id"]}
            )
        if result.get("destroyedTank"):
            tank = result["destroyedTank"]
            tank_rect = get_bound_rect_at(tank, tank["x"], tank["y"])
            center = get_rect_center(tank_rect)
            session["events"].append(
                {"type": "fx", "name": "destroy_tank", "x": center["x"], "y": center["y"], "tankId": tank["id"]}
            )
            if tank.get("role") == "ai":
                session["enemiesDestroyed"] += 1
                session["players"] = [p for p in session["players"] if p["id"] != tank["id"]]
                session.get("aiRuntime", {}).pop(tank["id"], None)
            elif tank.get("role") == "player":
                meta = session["playerMeta"].get(tank["id"], {})
                remaining_respawns = meta.get("respawnsRemaining", 0)
                if remaining_respawns > 0:
                    meta["respawnsRemaining"] = remaining_respawns - 1
                    session["playerMeta"][tank["id"]] = meta
                    spawn_index = meta.get("spawnIndex", 0)
                    if session["playerSpawns"]:
                        spawn_index = min(max(0, spawn_index), len(session["playerSpawns"]) - 1)
                        spawn = session["playerSpawns"][spawn_index]
                        tank_def = session["tankDefs"].get(tank["label"])
                        center = get_spawn_center_for_tank(session["mapData"], session["players"], tank_def, spawn)
                        tank["x"] = center["x"]
                        tank["y"] = center["y"]
                        tank["health"] = tank["maxHealth"]
                        tank["dirX"] = 0
                        tank["dirY"] = -1
                else:
                    session["gameOver"] = True
                    session["gameOverReason"] = "player_destroyed"
        if result.get("hqDestroyed"):
            session["gameOver"] = True
            session["gameOverReason"] = "hq_destroyed"
        events.append(
            {
                "ownerId": bullet.get("ownerId"),
                "hitTank": result.get("hitTank"),
                "blocked": bool(result.get("blocked")),
                "hqDestroyed": bool(result.get("hqDestroyed")),
            }
        )
    session["bullets"] = remaining
    return events


def decay_cooldowns(session):
    for tank in session["players"]:
        if tank["shootCooldown"] > 0:
            tank["shootCooldown"] -= 1


def is_ai_debug_enabled(session):
    for meta in session.get("wsMeta", {}).values():
        if meta.get("role") == "player" and meta.get("debugAI"):
            return True
    return False


def is_gbe_debug_enabled(session):
    for meta in session.get("wsMeta", {}).values():
        if meta.get("role") == "player" and meta.get("debugGBE"):
            return True
    return False


def format_received_actions(session, metrics):
    events = metrics.get("aiMoveEvents")
    if not isinstance(events, dict) or not events:
        return "--"
    chunks = []
    for tank_id, moves in events.items():
        tank_text = str(tank_id)
        if "|" in tank_text:
            raw_id, _ = tank_text.split("|", 1)
            short_id = to_network_id(session, raw_id)
        else:
            short_id = to_network_id(session, tank_text)
        move_list = moves if isinstance(moves, list) else []
        action_text = ", ".join(str(item) for item in move_list) if move_list else "none"
        chunks.append(f"AI Tank {short_id}: {action_text}")
    return " | ".join(chunks)


def build_ai_debug_state(session):
    ai_tanks = [tank for tank in session["players"] if tank.get("role") == "ai" and tank.get("health", 0) > 0]
    if not ai_tanks:
        return "ai=0"
    runtime = session.get("aiRuntime", {})
    moving = 0
    blocked = 0
    chunks = []
    for tank in ai_tanks[:4]:
        meta = runtime.get(tank["id"], {})
        did_move = bool(meta.get("lastDidMove"))
        if did_move:
            moving += 1
        else:
            blocked += 1
        target = get_nearest_player_tank(session, tank)
        target_text = "none"
        if target:
            target_text = f"({target['x']},{target['y']})"
        move_text = meta.get("lastMove") or "none"
        chunks.append(
            f"{tank['id'][:6]}:m={move_text}:mv={1 if did_move else 0}:t={target_text}"
        )
    return f"ai={len(ai_tanks)} moving={moving} blocked={blocked} | " + " | ".join(chunks)


def snapshot_state(session, include_ai_debug_labels=False, include_gbe_debug_labels=False):
    metrics = session.get("aiTrainDebug", {})
    ai_debug_enabled = is_ai_debug_enabled(session)
    gbe_debug_enabled = is_gbe_debug_enabled(session)
    ai_debug_values = {
        "state": metrics.get("state"),
        "action": metrics.get("action"),
        "reward": metrics.get("reward"),
        "rewardReasons": metrics.get("rewardReasons"),
        "epsilon": metrics.get("epsilon"),
        "tdLoss": metrics.get("tdLoss"),
        "qMean": metrics.get("qMean"),
        "steps": metrics.get("steps"),
        "episodes": metrics.get("episodes"),
        "modelPoolAvailable": metrics.get("modelPoolAvailable"),
        "modelPoolTotal": metrics.get("modelPoolTotal"),
        "modelPoolInUse": metrics.get("modelPoolInUse"),
        "transitionsReceived": metrics.get("transitionsReceived"),
        "actionsGenerated": metrics.get("actionsGenerated"),
        "actionTick": metrics.get("actionTick"),
        "modelInstancesBrief": metrics.get("modelInstancesBrief"),
        "rewardBatchCount": metrics.get("rewardBatchCount"),
        "rewardBatchSum": metrics.get("rewardBatchSum"),
        "trainStepsDelta": metrics.get("trainStepsDelta"),
        "episodeLog": metrics.get("episodeLog"),
        "episodeLogTick": metrics.get("episodeLogTick"),
        "perfTrainMs": metrics.get("perfTrainMs"),
        "perfInferMs": metrics.get("perfInferMs"),
        "asyncSaveMs": metrics.get("asyncSaveMs"),
        "memModelBytes": metrics.get("memModelBytes"),
        "memTrainStateBytes": metrics.get("memTrainStateBytes"),
        "memHistoryBytes": metrics.get("memHistoryBytes"),
        "gbeInputEvents": session.get("aiInputEventTotal", 0),
        "buildState": metrics.get("buildState"),
        "sentObserve": metrics.get("sentObserve"),
        "workerAction": metrics.get("workerAction"),
        "returnedAction": metrics.get("returnedAction"),
        "maxAliveCap": session.get("maxEnemyCount", 0),
        "aliveAi": count_alive_ai_tanks(session),
        "receivedActions": format_received_actions(session, metrics),
    }
    inference_summary = build_inference_summary(session)
    if inference_summary:
        ai_debug_values.update(
            {
                "inferenceEpisodeCount": inference_summary.get("episodeCount"),
                "inferenceAvgReward": inference_summary.get("avgReward"),
                "inferenceAvgSteps": inference_summary.get("avgSteps"),
                "inferenceWinRate": inference_summary.get("winRate"),
                "inferenceHitRate": inference_summary.get("hitRate"),
                "inferenceHqRate": inference_summary.get("hqRate"),
                "inferenceAvgDamageDealt": inference_summary.get("avgDamageDealt"),
                "inferenceAvgDamageTaken": inference_summary.get("avgDamageTaken"),
                "inferenceAvgTimeToWin": inference_summary.get("avgTimeToWin"),
            }
        )
    gbe_debug_values = {
        "stateSource": "metrics",
        "sessionCount": len(sessions),
        "recvTotal": session["aiInputRecvTotal"],
        "appliedTotal": session["aiInputAppliedTotal"],
        "lastReceived": serialize_ai_input_meta(session, session["lastAiInputReceived"]),
        "lastApplied": serialize_ai_input_meta(session, session["lastAiInputApplied"]),
        "errorCount": session["aiErrorCount"],
        "lastError": session["lastAiError"],
        "aiSocketCount": len(session["aiSockets"]),
        "clientSocketCount": len(session["sockets"]),
    }
    state = {
        "tick": session["tick"],
        "mapName": session["mapData"]["name"],
        "players": [
            {
                "id": to_network_id(session, p["id"]),
                "label": p["label"],
                "role": p.get("role"),
                "x": p["x"],
                "y": p["y"],
                "dirX": p["dirX"],
                "dirY": p["dirY"],
                "health": p["health"],
                "maxHealth": p["maxHealth"],
            }
            for p in session["players"]
        ],
        "bullets": [
            {
                "id": to_network_id(session, b["id"]),
                "x": b["x"],
                "y": b["y"],
                "dirX": b["dirX"],
                "dirY": b["dirY"],
                "radius": b["radius"],
            }
            for b in session["bullets"]
        ],
        "events": [serialize_event_for_network(session, event) for event in session["events"]],
        "gameOver": session["gameOver"],
        "gameOverReason": session["gameOverReason"],
        "gameOverFx": session["gameOverFx"],
        "stats": {
            "ticks": session["tick"],
            "enemiesDestroyed": session["enemiesDestroyed"],
        },
        "aiDebug": None,
        "gbeDebug": None,
    }
    if ai_debug_enabled:
        try:
            backend_state = build_ai_debug_state(session)
            metrics["buildState"] = True
            session["aiTrainDebug"] = metrics
            if not ai_debug_values.get("state"):
                ai_debug_values["state"] = backend_state
            ai_debug_values["buildState"] = True
        except Exception as error:
            set_ai_error(session, "ai_state_build", error)
            ai_debug_values["state"] = "error: failed to build ai state"
    else:
        if not ai_debug_values.get("state"):
            ai_debug_values["state"] = "--"
    if ai_debug_enabled:
        state["aiDebug"] = pack_debug_for_network(session, "aiDebug", ai_debug_values, include_ai_debug_labels)
    if gbe_debug_enabled:
        state["gbeDebug"] = pack_debug_for_network(session, "gbeDebug", gbe_debug_values, include_gbe_debug_labels)
    if session.get("mapTileUpdates"):
        state["mapTilesChanged"] = session.get("mapTileUpdates", [])
    return state


def build_delta_state(prev_state, next_state):
    if not prev_state:
        player_payload = {
            "labels": PLAYER_STATE_LABELS,
            "upserts": [values_from_labels(item, PLAYER_STATE_LABELS) for item in next_state.get("players", [])],
            "removed": [],
        }
        bullet_payload = {
            "labels": BULLET_STATE_LABELS,
            "upserts": [values_from_labels(item, BULLET_STATE_LABELS) for item in next_state.get("bullets", [])],
            "removed": [],
        }
        return {
            "delta": True,
            "tick": next_state["tick"],
            "mapName": next_state.get("mapName"),
            "players": player_payload,
            "bullets": bullet_payload,
            "events": next_state.get("events", []),
            "gameOver": next_state.get("gameOver"),
            "gameOverReason": next_state.get("gameOverReason"),
            "gameOverFx": next_state.get("gameOverFx"),
            "stats": next_state.get("stats"),
            "aiDebug": next_state.get("aiDebug"),
            "gbeDebug": next_state.get("gbeDebug"),
            **({"mapTilesChanged": next_state["mapTilesChanged"]} if "mapTilesChanged" in next_state else {}),
        }

    delta = {
        "delta": True,
        "tick": next_state["tick"],
    }

    if next_state.get("mapName") != prev_state.get("mapName"):
        delta["mapName"] = next_state.get("mapName")

    prev_players = {item["id"]: item for item in prev_state.get("players", [])}
    next_players = {item["id"]: item for item in next_state.get("players", [])}
    player_upserts = []
    for pid, item in next_players.items():
        if pid not in prev_players or prev_players[pid] != item:
            player_upserts.append(item)
    player_removed = [pid for pid in prev_players.keys() if pid not in next_players]
    if player_upserts or player_removed:
        delta["players"] = {
            "upserts": [values_from_labels(item, PLAYER_STATE_LABELS) for item in player_upserts],
            "removed": player_removed,
        }

    prev_bullets = {item["id"]: item for item in prev_state.get("bullets", [])}
    next_bullets = {item["id"]: item for item in next_state.get("bullets", [])}
    bullet_upserts = []
    for bid, item in next_bullets.items():
        if bid not in prev_bullets or prev_bullets[bid] != item:
            bullet_upserts.append(item)
    bullet_removed = [bid for bid in prev_bullets.keys() if bid not in next_bullets]
    if bullet_upserts or bullet_removed:
        delta["bullets"] = {
            "upserts": [values_from_labels(item, BULLET_STATE_LABELS) for item in bullet_upserts],
            "removed": bullet_removed,
        }

    if next_state.get("events"):
        delta["events"] = next_state["events"]
    if next_state.get("gameOver") != prev_state.get("gameOver"):
        delta["gameOver"] = next_state.get("gameOver")
    if next_state.get("gameOverReason") != prev_state.get("gameOverReason"):
        delta["gameOverReason"] = next_state.get("gameOverReason")
    if next_state.get("gameOverFx") != prev_state.get("gameOverFx"):
        delta["gameOverFx"] = next_state.get("gameOverFx")
    if next_state.get("stats") != prev_state.get("stats"):
        delta["stats"] = next_state.get("stats")
    if next_state.get("aiDebug") != prev_state.get("aiDebug"):
        delta["aiDebug"] = next_state.get("aiDebug")
    if next_state.get("gbeDebug") != prev_state.get("gbeDebug"):
        delta["gbeDebug"] = next_state.get("gbeDebug")
    if "mapTilesChanged" in next_state:
        delta["mapTilesChanged"] = next_state["mapTilesChanged"]

    return delta


async def broadcast_state(session):
    state = snapshot_state(session)
    delta_state = build_delta_state(session.get("lastState"), state)
    payload = json.dumps({"type": "state", "state": delta_state})
    payload_bytes = payload.encode("utf-8")
    session["netBytesSentTick"] = 0
    dead = []
    send_start = time.perf_counter()
    for ws in session["sockets"]:
        try:
            await ws.send_str(payload)
            session["netBytesSent"] += len(payload_bytes)
            session["netBytesSentTick"] += len(payload_bytes)
            net = session.get("netBreakdown", {})
            net["stateBytesTotal"] = int(net.get("stateBytesTotal", 0)) + len(payload_bytes)
            net["stateBytesTick"] = int(net.get("stateBytesTick", 0)) + len(payload_bytes)
            session["netBreakdown"] = net
        except Exception:
            dead.append(ws)
    send_ms = (time.perf_counter() - send_start) * 1000
    for ws in dead:
        session["sockets"].discard(ws)
        session["aiSockets"].discard(ws)
        session["wsMeta"].pop(ws, None)
    session["events"] = []
    session["mapDirty"] = False
    session["mapTileUpdates"] = []
    metrics = session.get("aiTrainDebug", {})
    metrics["playerSendMs"] = send_ms
    session["aiTrainDebug"] = metrics
    return state


async def tick_session(session):
    prev_state = session["lastState"]
    tick_start = time.perf_counter()
    last_tick_at = session.get("lastTickAt")
    session["tick"] += 1
    net = session.get("netBreakdown", {})
    for key in list(net.keys()):
        if key.endswith("BytesTick"):
            net[key] = 0
    session["netBreakdown"] = net
    metrics = session.get("aiTrainDebug", {})
    metrics["steps"] = session["tick"]
    if isinstance(last_tick_at, (int, float)):
        metrics["tickIntervalMs"] = (tick_start - last_tick_at) * 1000
    session["lastTickAt"] = tick_start
    has_ai_sockets = len(session["aiSockets"]) > 0
    metrics["sentObserve"] = has_ai_sockets
    metrics["buildState"] = False
    session["aiTrainDebug"] = metrics
    if has_ai_sockets:
        last_err = session.get("lastAiError")
        if isinstance(last_err, dict) and last_err.get("step") == "ai_backend_connection":
            session["lastAiError"] = None
        session["aiBackendDisconnectedLogged"] = False
    if not session.get("gameOver"):
        session["enemySpawnTimerTicks"] += 1
        if session["enemySpawnTimerTicks"] >= session["enemySpawnIntervalTicks"]:
            spawn_enemy(session)
            session["enemySpawnTimerTicks"] = 0
    session["predictedShots"] = []
    input_start = time.perf_counter()
    handle_input_queue(session)
    input_ms = (time.perf_counter() - input_start) * 1000
    bullets_start = time.perf_counter()
    bullet_events = update_bullets(session)
    bullets_ms = (time.perf_counter() - bullets_start) * 1000
    cooldown_start = time.perf_counter()
    decay_cooldowns(session)
    cooldown_ms = (time.perf_counter() - cooldown_start) * 1000
    ai_targets = [tank for tank in session["players"] if tank.get("role") == "ai" and tank.get("health", 0) > 0]
    player_targets = [tank for tank in session["players"] if tank.get("role") == "player" and tank.get("health", 0) > 0]
    player = player_targets[0] if player_targets else None
    hq_center = get_hq_center(session)
    runtime = session.setdefault("aiRuntime", {})
    selected_tank_id = None
    last_applied = session.get("lastAiInputApplied")
    if isinstance(last_applied, dict):
        selected_tank_id = last_applied.get("tankId")
    reward_debug = None
    reasons_debug = None
    ai_rewards = []
    reward_start = time.perf_counter()
    map_data = session.get("mapData")
    tile_size = map_data.get("tileSize", 0) if map_data else 0
    for tank in ai_targets:
        meta = runtime.get(tank["id"]) or {"idleTicks": 0}
        prev_dist_player = meta.get("prevDistPlayer")
        prev_dist_hq = meta.get("prevDistHQ")
        player_dist = compute_distance(tank["x"], tank["y"], player["x"], player["y"]) if player else 0
        hq_dist = compute_distance(tank["x"], tank["y"], hq_center["x"], hq_center["y"]) if hq_center else 0
        reward = 0.0
        reasons = []
        tank_rect = get_bound_rect_at(tank, tank["x"], tank["y"])
        tank_center = get_rect_center(tank_rect)
        dir_x = tank.get("dirX", 0)
        dir_y = tank.get("dirY", 0)
        if player:
            player_rect = get_bound_rect_at(player, player["x"], player["y"])
            if ray_reaches_rect(session["mapData"], tank_center["x"], tank_center["y"], dir_x, dir_y, player_rect):
                reward += RL_REWARD_WEIGHTS["playerAim"]
                if RL_REWARD_WEIGHTS["playerAim"] != 0:
                    reasons.append("playerAim")
        if hq_center:
            tile_size = session["mapData"]["tileSize"]
            hq_rect = {
                "x": hq_center["x"] - tile_size // 2,
                "y": hq_center["y"] - tile_size // 2,
                "w": tile_size,
                "h": tile_size,
            }
            if ray_reaches_rect(session["mapData"], tank_center["x"], tank_center["y"], dir_x, dir_y, hq_rect):
                reward += RL_REWARD_WEIGHTS["hqAim"]
                if RL_REWARD_WEIGHTS["hqAim"] != 0:
                    reasons.append("hqAim")
        if meta.get("idleTicks", 0) >= RL_IDLE_TICKS:
            reward += RL_REWARD_WEIGHTS["idlePenalty"]
            if RL_REWARD_WEIGHTS["idlePenalty"] != 0:
                reasons.append("idlePenalty")
        if tile_size > 0:
            tank_row = int(tank["y"] // tile_size)
            tank_col = int(tank["x"] // tile_size)
            tile_key = f"{tank_row},{tank_col}"
            visited = meta.get("visitedTiles")
            if not isinstance(visited, set):
                visited = set()
            if tile_key not in visited:
                visited.add(tile_key)
                reward += RL_REWARD_WEIGHTS["mapTileTouched"]
                if RL_REWARD_WEIGHTS["mapTileTouched"] != 0:
                    reasons.append("mapTileTouched")
            meta["visitedTiles"] = visited
            visited_count = len(visited)
            last_count = int(meta.get("lastVisitedCount", visited_count))
            last_tick = meta.get("lastVisitedTick")
            if visited_count > last_count or last_tick is None:
                meta["lastVisitedCount"] = visited_count
                meta["lastVisitedTick"] = session.get("tick", 0)
            total_tiles = int(session.get("totalAccessibleTiles", 0))
            if total_tiles > 0 and (visited_count / total_tiles) < 0.75:
                last_tick = int(meta.get("lastVisitedTick", session.get("tick", 0)))
                stall_ticks = session.get("tick", 0) - last_tick
                if stall_ticks >= RL_EXPLORE_STALL_TICKS:
                    reward += RL_REWARD_WEIGHTS["exploreStallPenalty"]
                    if RL_REWARD_WEIGHTS["exploreStallPenalty"] != 0:
                        reasons.append("exploreStallPenalty")
        if tile_size > 0:
            tank_row = int(tank["y"] // tile_size)
            tank_col = int(tank["x"] // tile_size)
            area = meta.get("stuckAreaCenter")
            if not area:
                area = {"row": tank_row, "col": tank_col}
                meta["stuckAreaTicks"] = 0
            in_area = abs(tank_row - area["row"]) <= 1 and abs(tank_col - area["col"]) <= 1
            if in_area:
                meta["stuckAreaTicks"] = int(meta.get("stuckAreaTicks", 0)) + 1
            else:
                area = {"row": tank_row, "col": tank_col}
                meta["stuckAreaTicks"] = 0
            meta["stuckAreaCenter"] = area
            if meta.get("stuckAreaTicks", 0) >= RL_STUCK_AREA_TICKS:
                reward += RL_REWARD_WEIGHTS["stuckAreaPenalty"]
                if RL_REWARD_WEIGHTS["stuckAreaPenalty"] != 0:
                    reasons.append("stuckArea")
        prev_dir_x = meta.get("prevDirX", tank.get("dirX", 0))
        prev_dir_y = meta.get("prevDirY", tank.get("dirY", 0))
        direction_changed = (tank.get("dirX", 0) != prev_dir_x or tank.get("dirY", 0) != prev_dir_y)
        ticks_since = int(meta.get("ticksSinceDirChange", 0))
        if direction_changed:
            ticks_since = 0
        else:
            ticks_since += 1
        if direction_changed and (RL_DIR_CHANGE_COOLDOWN <= 0 or ticks_since < RL_DIR_CHANGE_COOLDOWN):
            reward += RL_REWARD_WEIGHTS["directionChangePenalty"]
            if RL_REWARD_WEIGHTS["directionChangePenalty"] != 0:
                reasons.append("directionChange")
        if meta.get("blockedMove"):
            reward += RL_REWARD_WEIGHTS["collisionPenalty"]
            reasons.append("collisionPenalty")
            meta["blockedMove"] = False
        predicted_shots = session.get("predictedShots", [])
        for shot in predicted_shots:
            result_type = shot.get("resultType")
            owner_id = shot.get("ownerId")
            owner_role = shot.get("ownerRole")
            target_id = shot.get("targetId")
            if result_type == "ai" and target_id == tank["id"]:
                reward += RL_REWARD_WEIGHTS["gotHit"]
                reasons.append("gotHit")
            if owner_role != "ai" or owner_id != tank["id"]:
                continue
            if result_type == "player":
                reward += RL_REWARD_WEIGHTS["hitPlayer"]
                reasons.append("hitPlayer")
            elif result_type == "hq":
                reward += RL_REWARD_WEIGHTS["destroyHQ"]
                reasons.append("destroyHQ")
            elif result_type == "ai" and target_id and target_id != tank["id"]:
                reward += RL_REWARD_WEIGHTS["hitAlly"]
                reasons.append("hitAlly")
            elif result_type == "tile_non_destructible":
                reward += RL_REWARD_WEIGHTS["nonDestructiveShotPenalty"]
                reasons.append("blockedShot")
            elif result_type == "tile_destructible":
                reward += RL_REWARD_WEIGHTS["destructiveShot"]
                reasons.append("destructiveShot")
        if tank.get("health", 0) <= 0:
            reward += RL_REWARD_WEIGHTS["death"]
            reasons.append("death")
        if session.get("gameOverReason") == "hq_destroyed" and not session.get("hqRewarded"):
            reward += RL_REWARD_WEIGHTS["destroyHQ"]
            reasons.append("destroyHQ")
        meta["prevDistPlayer"] = player_dist if player else None
        meta["prevDistHQ"] = hq_dist if hq_center else None
        meta["prevDirX"] = tank.get("dirX", 0)
        meta["prevDirY"] = tank.get("dirY", 0)
        meta["ticksSinceDirChange"] = ticks_since
        runtime[tank["id"]] = meta
        ai_rewards.append(
            {
                "tankId": to_network_id(session, tank["id"]),
                "reward": reward,
                "rewardReasons": reasons or ["none"],
            }
        )
        if selected_tank_id == tank["id"] or (selected_tank_id is None and reward_debug is None):
            reward_debug = reward
            reasons_debug = reasons or ["none"]
    reward_accum = session.setdefault("aiRewardAccum", {})
    for entry in ai_rewards:
        tank_id = entry.get("tankId")
        if not tank_id:
            continue
        acc = reward_accum.get(tank_id)
        if not acc:
            acc = {"reward": 0.0, "reasons": set()}
        try:
            acc["reward"] += float(entry.get("reward", 0))
        except (TypeError, ValueError):
            pass
        for reason in entry.get("rewardReasons") or []:
            acc["reasons"].add(reason)
        reward_accum[tank_id] = acc
    predicted_shots = session.get("predictedShots", [])
    update_inference_metrics(session, ai_rewards, bullet_events, predicted_shots)
    if session.get("gameOverReason") == "hq_destroyed":
        session["hqRewarded"] = True
    reward_ms = (time.perf_counter() - reward_start) * 1000
    if reward_debug is not None:
        metrics = session.get("aiTrainDebug", {})
        metrics["reward"] = reward_debug
        metrics["rewardReasons"] = reasons_debug or ["none"]
        session["aiTrainDebug"] = metrics
    if session.get("gameOver") and session.get("removeAtTick") is None:
        session["removeAtTick"] = session["tick"] + 1
        fx_x = 0
        fx_y = 0
        if session["mapData"] and session.get("playerHQ"):
            hq = session["playerHQ"]
            fx_x = hq["col"] * session["mapData"]["tileSize"] + (session["mapData"]["tileSize"] // 2)
            fx_y = hq["row"] * session["mapData"]["tileSize"] + (session["mapData"]["tileSize"] // 2)
        else:
            fx_x = session["mapData"]["mapSize"] // 2
            fx_y = session["mapData"]["mapSize"] // 2
        session["events"].append({"type": "fx", "name": "destroy_hq", "x": fx_x, "y": fx_y})
        session["events"].append({"type": "fx", "name": "game_over", "x": fx_x, "y": fx_y})
    broadcast_start = time.perf_counter()
    state = await broadcast_state(session)
    broadcast_ms = (time.perf_counter() - broadcast_start) * 1000
    ai_send_start = time.perf_counter()
    transition_interval = max(1, int(session.get("transitionInterval", 1)))
    should_send_transition = bool(session["aiSockets"]) and (
        transition_interval <= 1
        or (session["tick"] % transition_interval == 0)
        or session.get("gameOver")
    )
    if should_send_transition:
        ai_send_await_start = time.perf_counter()
        reward_accum = session.get("aiRewardAccum", {})
        ai_rewards_to_send = []
        for tank_id, acc in reward_accum.items():
            reasons = list(acc.get("reasons") or [])
            if not reasons:
                reasons = ["none"]
            ai_rewards_to_send.append(
                {
                    "tankId": tank_id,
                    "reward": acc.get("reward", 0.0),
                    "rewardReasons": reasons,
                }
            )
        prev_transition_state = session.get("lastTransitionState") or prev_state or state
        transition = json.dumps(
            {
                "type": "transition",
                "prevState": prev_transition_state,
                "nextState": state,
                "reward": 0,
                "aiRewards": ai_rewards_to_send,
                "tick": session["tick"],
            }
        )
        session["aiRewardAccum"] = {}
        session["lastTransitionState"] = state
        transition_bytes = transition.encode("utf-8")
        dead = []
        for ws in session["aiSockets"]:
            try:
                await ws.send_str(transition)
                session["netBytesSent"] += len(transition_bytes)
                session["netBytesSentTick"] += len(transition_bytes)
                net = session.get("netBreakdown", {})
                net["transitionBytesTotal"] = int(net.get("transitionBytesTotal", 0)) + len(transition_bytes)
                net["transitionBytesTick"] = int(net.get("transitionBytesTick", 0)) + len(transition_bytes)
                session["netBreakdown"] = net
            except Exception:
                dead.append(ws)
        ai_send_await_ms = (time.perf_counter() - ai_send_await_start) * 1000
        log_ai_connection(
            session,
            "transition_sent",
            {"aiSockets": len(session["aiSockets"]), "tick": session["tick"]},
        )
        for ws in dead:
            session["sockets"].discard(ws)
            session["aiSockets"].discard(ws)
            session["wsMeta"].pop(ws, None)
            log_ai_connection(session, "ai_socket_send_failed", {"tick": session["tick"]})
    else:
        metrics = session.get("aiTrainDebug", {})
        metrics["sentObserve"] = False
        session["aiTrainDebug"] = metrics
        if not session.get("aiBackendDisconnectedLogged"):
            set_ai_error(session, "ai_backend_connection", "AI Backend is not connected")
            session["aiBackendDisconnectedLogged"] = True
            log_ai_connection(session, "ai_backend_disconnected", {"tick": session["tick"]})
        ai_send_await_ms = 0.0
    ai_send_ms = (time.perf_counter() - ai_send_start) * 1000
    tick_ms = (time.perf_counter() - tick_start) * 1000
    metrics = session.get("aiTrainDebug", {})
    metrics["tickMs"] = tick_ms
    metrics["inputMs"] = input_ms
    metrics["bulletsMs"] = bullets_ms
    metrics["cooldownMs"] = cooldown_ms
    metrics["rewardMs"] = reward_ms
    metrics["broadcastMs"] = broadcast_ms
    metrics["aiSendMs"] = ai_send_ms
    metrics["aiSendAwaitMs"] = ai_send_await_ms
    session["aiTrainDebug"] = metrics
    session["lastState"] = state


async def tick_loop():
    tick_s = TICK_MS / 1000
    max_catch_up = int(os.getenv("MAX_TICK_CATCH_UP", "3"))
    next_tick_time = time.perf_counter()
    while True:
        now = time.perf_counter()
        sleep_ms = 0.0
        if now < next_tick_time:
            sleep_start = time.perf_counter()
            await asyncio.sleep(next_tick_time - now)
            sleep_ms = (time.perf_counter() - sleep_start) * 1000
            now = time.perf_counter()
        loop_start = time.perf_counter()
        ticks_run = 0
        while now >= next_tick_time and ticks_run < max_catch_up:
            for session in list(sessions.values()):
                if not session["sockets"] and not session["aiSockets"]:
                    if session.get("gameOver"):
                        if session.get("removeAtTick") is None:
                            session["removeAtTick"] = session["tick"] + int(5000 / TICK_MS)
                        if session["tick"] >= session["removeAtTick"]:
                            sessions.pop(session["id"], None)
                    continue
                await tick_session(session)
                if session["tick"] % 30 == 0:
                    print(
                        f"[session {session['id']}] tick={session['tick']} "
                        f"bytesTick={session['netBytesSentTick']} "
                        f"bytesTotal={session['netBytesSent']} "
                        f"inputsTick={session['inputCountTick']} "
                        f"inputsTotal={session['inputCountTotal']}"
                    )
                '''
                net = session.get("netBreakdown", {})
                print(
                    f"[session {session['id']}] net-breakdown "
                    f"stateTick={net.get('stateBytesTick', 0)} "
                    f"transitionTick={net.get('transitionBytesTick', 0)} "
                    f"playerInTick={net.get('playerInputWsBytesTick', 0)} "
                    f"aiWsInTick={net.get('aiInputWsBytesTick', 0)} "
                    f"aiHttpInTick={net.get('aiInputHttpBytesTick', 0)}"
                )
                '''
                session["inputCountTick"] = 0
                if session.get("gameOver") and session.get("removeAtTick") is not None:
                    if session["tick"] >= session["removeAtTick"]:
                        for ws in list(session["sockets"]) + list(session["aiSockets"]):
                            with contextlib.suppress(Exception):
                                await ws.close()
                        sessions.pop(session["id"], None)
            next_tick_time += tick_s
            ticks_run += 1
            now = time.perf_counter()
        if now >= next_tick_time:
            next_tick_time = now + tick_s
        work_ms = (time.perf_counter() - loop_start) * 1000
        loop_interval_ms = work_ms + sleep_ms
        for session in sessions.values():
            metrics = session.get("aiTrainDebug", {})
            metrics["loopWorkMs"] = work_ms
            metrics["loopWaitMs"] = sleep_ms
            metrics["loopIntervalMs"] = loop_interval_ms
            session["aiTrainDebug"] = metrics


def parse_json_request(request):
    try:
        return request.json()
    except Exception:
        return None


async def handle_create_session(request):
    payload = {}
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    session = create_session(payload.get("mapName"), payload.get("maxEnemiesAlive"))
    tank = assign_player(session)
    if not tank:
        return web.json_response({"error": "No available player spawns"}, status=400)
    log_ai_connection(session, "player_assigned", {"playerId": tank["id"]})
    return web.json_response(
        {
            "sessionId": session["id"],
            "playerId": to_network_id(session, tank["id"]),
            "map": session["mapData"],
            "state": snapshot_state(session, include_ai_debug_labels=True, include_gbe_debug_labels=True),
            "modelKey": session.get("modelKey"),
            "mapKey": session.get("mapKey"),
        }
    )


async def handle_join_session(request):
    session_id = request.match_info.get("sessionId")
    session = sessions.get(session_id)
    if not session:
        return web.json_response({"error": "Session not found"}, status=404)
    tank = assign_player(session)
    if not tank:
        return web.json_response({"error": "Session full"}, status=400)
    log_ai_connection(session, "player_joined", {"playerId": tank["id"]})
    return web.json_response(
        {
            "sessionId": session["id"],
            "playerId": to_network_id(session, tank["id"]),
            "map": session["mapData"],
            "state": snapshot_state(session, include_ai_debug_labels=True, include_gbe_debug_labels=True),
        }
    )


async def handle_list_sessions(request):
    active = []
    for session in sessions.values():
        active.append(
            {
                "sessionId": session["id"],
                "tick": session["tick"],
                "gameOver": session["gameOver"],
                "players": len(session["players"]),
                "mapName": session.get("mapData", {}).get("name"),
                "modelKey": session.get("modelKey"),
                "mapKey": session.get("mapKey"),
            }
        )
    return web.json_response({"sessions": active})


async def handle_ai_input(request):
    session_id = request.match_info.get("sessionId")
    session = sessions.get(session_id)
    if not session:
        return web.json_response({"error": "Session not found"}, status=404)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid payload"}, status=400)
    events = payload.get("events")
    if not isinstance(events, list):
        events = []
    try:
        payload_size = len(json.dumps(payload).encode("utf-8"))
    except Exception:
        payload_size = 0
    net = session.get("netBreakdown", {})
    net["aiInputHttpBytesTotal"] = int(net.get("aiInputHttpBytesTotal", 0)) + payload_size
    net["aiInputHttpBytesTick"] = int(net.get("aiInputHttpBytesTick", 0)) + payload_size
    session["netBreakdown"] = net
    for event in events:
        entry = {
            "tankId": resolve_network_id(session, event.get("tankId")),
            "move": event.get("move") or None,
            "fire": bool(event.get("fire")),
            "source": "ai",
        }
        if isinstance(event.get("debug"), dict):
            update_ai_train_debug(session, event.get("debug"))
        session["aiInputs"].append(entry)
        session["aiInputRecvTotal"] += 1
        session["lastAiInputReceived"] = {
            "tankId": entry["tankId"],
            "move": entry["move"],
            "fire": entry["fire"],
            "tick": session.get("tick", 0),
            "source": "ai",
        }
    if events:
        log_ai_connection(session, "ai_input_http_received", {"count": len(events)})
    return web.json_response({"ok": True})


async def websocket_handler(request):
    session_id = request.query.get("sessionId")
    session = sessions.get(session_id)
    if not session:
        return web.Response(status=404, text="Session not found")
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    session["sockets"].add(ws)
    session["wsMeta"][ws] = {
        "sessionId": session_id,
        "role": "player",
        "playerId": None,
        "debugAI": False,
        "debugGBE": False,
    }
    log_ai_connection(session, "ws_connected", {"remote": request.remote})
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                try:
                    msg_size = len(msg.data.encode("utf-8"))
                except Exception:
                    msg_size = 0
                if data.get("type") == "join":
                    net = session.get("netBreakdown", {})
                    net["joinWsBytesTotal"] = int(net.get("joinWsBytesTotal", 0)) + msg_size
                    net["joinWsBytesTick"] = int(net.get("joinWsBytesTick", 0)) + msg_size
                    session["netBreakdown"] = net
                    prev = session["wsMeta"].get(ws, {})
                    session["wsMeta"][ws] = {
                        "sessionId": data.get("sessionId"),
                        "role": data.get("role") or "player",
                        "playerId": resolve_network_id(session, data.get("playerId")),
                        "debugAI": bool(prev.get("debugAI")),
                        "debugGBE": bool(prev.get("debugGBE")),
                    }
                    if data.get("role") == "ai":
                        if ws not in session["aiSockets"] and session["aiSockets"]:
                            prev_count = len(session["aiSockets"])
                            for old_ws in list(session["aiSockets"]):
                                session["sockets"].discard(old_ws)
                                session["aiSockets"].discard(old_ws)
                                session["wsMeta"].pop(old_ws, None)
                                with contextlib.suppress(Exception):
                                    await old_ws.close()
                            log_ai_connection(session, "ai_ws_replaced", {"count": prev_count})
                        session["aiSockets"].add(ws)
                        session["aiBackendDisconnectedLogged"] = False
                        log_ai_connection(session, "ai_ws_join", {"sessionId": data.get("sessionId")})
                    else:
                        log_ai_connection(session, "player_ws_join", {"playerId": data.get("playerId")})
                elif data.get("type") == "debug_ai_toggle":
                    net = session.get("netBreakdown", {})
                    net["debugToggleWsBytesTotal"] = int(net.get("debugToggleWsBytesTotal", 0)) + msg_size
                    net["debugToggleWsBytesTick"] = int(net.get("debugToggleWsBytesTick", 0)) + msg_size
                    session["netBreakdown"] = net
                    meta = session["wsMeta"].get(ws, {})
                    meta["debugAI"] = bool(data.get("enabled"))
                    session["wsMeta"][ws] = meta
                elif data.get("type") == "debug_gbe_toggle":
                    net = session.get("netBreakdown", {})
                    net["debugToggleWsBytesTotal"] = int(net.get("debugToggleWsBytesTotal", 0)) + msg_size
                    net["debugToggleWsBytesTick"] = int(net.get("debugToggleWsBytesTick", 0)) + msg_size
                    session["netBreakdown"] = net
                    meta = session["wsMeta"].get(ws, {})
                    meta["debugGBE"] = bool(data.get("enabled"))
                    session["wsMeta"][ws] = meta
                elif data.get("type") == "input":
                    meta = session["wsMeta"].get(ws, {})
                    entry = {
                        "tankId": resolve_network_id(session, data.get("tankId") or meta.get("playerId")),
                        "move": data.get("move") or None,
                        "fire": bool(data.get("fire")),
                    }
                    if data.get("role") == "ai":
                        net = session.get("netBreakdown", {})
                        net["aiInputWsBytesTotal"] = int(net.get("aiInputWsBytesTotal", 0)) + msg_size
                        net["aiInputWsBytesTick"] = int(net.get("aiInputWsBytesTick", 0)) + msg_size
                        session["netBreakdown"] = net
                        if isinstance(data.get("debug"), dict):
                            update_ai_train_debug(session, data.get("debug"))
                        entry["source"] = "ai"
                        session["aiInputs"].append(entry)
                        session["aiInputRecvTotal"] += 1
                        session["lastAiInputReceived"] = {
                            "tankId": entry["tankId"],
                            "move": entry["move"],
                            "fire": entry["fire"],
                            "tick": session.get("tick", 0),
                            "source": "ai",
                        }
                        log_ai_connection(
                            session,
                            "ai_input_ws_received",
                            {
                                "tankId": entry["tankId"],
                                "move": entry["move"],
                                "fire": bool(entry["fire"]),
                            },
                        )
                    else:
                        net = session.get("netBreakdown", {})
                        net["playerInputWsBytesTotal"] = int(net.get("playerInputWsBytesTotal", 0)) + msg_size
                        net["playerInputWsBytesTick"] = int(net.get("playerInputWsBytesTick", 0)) + msg_size
                        session["netBreakdown"] = net
                        session["playerInputs"].append(entry)
                    session["inputCountTick"] += 1
                    session["inputCountTotal"] += 1
                else:
                    net = session.get("netBreakdown", {})
                    net["otherWsInBytesTotal"] = int(net.get("otherWsInBytesTotal", 0)) + msg_size
                    net["otherWsInBytesTick"] = int(net.get("otherWsInBytesTick", 0)) + msg_size
                    session["netBreakdown"] = net
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        session["sockets"].discard(ws)
        session["aiSockets"].discard(ws)
        session["wsMeta"].pop(ws, None)
        log_ai_connection(session, "ws_disconnected", {"remote": request.remote})
    return ws


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        return web.Response(
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        )
    response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


async def on_startup(app):
    app["tick_task"] = asyncio.create_task(tick_loop())


async def on_cleanup(app):
    task = app.get("tick_task")
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def main():
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/sessions", handle_list_sessions)
    app.router.add_post("/session", handle_create_session)
    app.router.add_post("/session/{sessionId}/join", handle_join_session)
    app.router.add_post("/session/{sessionId}/ai-input", handle_ai_input)
    app.router.add_get("/ws", websocket_handler)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print(f"Game backend running at http://127.0.0.1:{GAME_BACKEND_PORT}")
    web.run_app(app, host="127.0.0.1", port=GAME_BACKEND_PORT)


if __name__ == "__main__":
    main()
