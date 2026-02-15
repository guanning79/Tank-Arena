import base64
import asyncio
import json
import os
import random
import sqlite3
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, unquote, parse_qs

import aiohttp

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT_DIR, "rl-models.db")
HOST = "127.0.0.1"
PORT = int(os.getenv("PORT", "5050"))
FREE_LIST = {}
LAST_POPPED = {}
GAME_BACKEND_URL = os.getenv("GAME_BACKEND_URL", "http://127.0.0.1:5051").rstrip("/")
GAME_BACKEND_WS_URL = os.getenv("GAME_BACKEND_WS_URL", "ws://127.0.0.1:5051/ws").rstrip("/")
AI_POLL_INTERVAL_SECONDS = float(os.getenv("AI_POLL_INTERVAL_SECONDS", "1.0"))
RL_GAMMA = float(os.getenv("RL_GAMMA", "0.95"))
RL_ALPHA = float(os.getenv("RL_ALPHA", "0.12"))
RL_EPSILON_START = float(os.getenv("RL_EPSILON_START", "1.0"))
RL_EPSILON_MIN = float(os.getenv("RL_EPSILON_MIN", "0.1"))
RL_EPSILON_DECAY = float(os.getenv("RL_EPSILON_DECAY", "0.9995"))
ACTION_MAP = [
    {"move": None, "fire": False},  # idle
    {"move": "move_up", "fire": False},
    {"move": "move_down", "fire": False},
    {"move": "move_left", "fire": False},
    {"move": "move_right", "fire": False},
    {"move": None, "fire": True},
    {"move": "move_up", "fire": True},
    {"move": "move_down", "fire": True},
    {"move": "move_left", "fire": True},
    {"move": "move_right", "fire": True},
]


def _is_ai_tank(player):
    label = str(player.get("label") or "")
    return label.endswith("_en")


def _is_player_tank(player):
    label = str(player.get("label") or "")
    return label.endswith("_pl")


def _clamp_int(value, lo, hi):
    return max(lo, min(hi, int(value)))


def _nearest_tank(source_tank, tanks):
    if not tanks:
        return None
    return min(
        tanks,
        key=lambda p: (int(p.get("x", 0)) - int(source_tank.get("x", 0))) ** 2
        + (int(p.get("y", 0)) - int(source_tank.get("y", 0))) ** 2,
    )


def _state_key(ai_tank, target):
    if not ai_tank or not target:
        return "no_target"
    dx = _clamp_int((int(target.get("x", 0)) - int(ai_tank.get("x", 0))) // 32, -12, 12)
    dy = _clamp_int((int(target.get("y", 0)) - int(ai_tank.get("y", 0))) // 32, -12, 12)
    dir_x = int(ai_tank.get("dirX", 0))
    dir_y = int(ai_tank.get("dirY", 0))
    return f"dx={dx}|dy={dy}|dir={dir_x},{dir_y}"


def _ensure_q_row(q_table, key):
    row = q_table.get(key)
    if row is None:
        row = [0.0 for _ in ACTION_MAP]
        q_table[key] = row
    return row


def _pick_action_index(q_table, key, epsilon):
    row = _ensure_q_row(q_table, key)
    if random.random() < epsilon:
        return random.randrange(len(ACTION_MAP))
    best_index = 0
    best_value = row[0]
    for idx, value in enumerate(row):
        if value > best_value:
            best_value = value
            best_index = idx
    return best_index


def _compute_transition_reward(prev_ai, next_ai, prev_target, next_target, prev_state, next_state):
    reward = 0.0
    prev_dist = 0
    next_dist = 0
    if prev_ai and prev_target:
        prev_dx = int(prev_target.get("x", 0)) - int(prev_ai.get("x", 0))
        prev_dy = int(prev_target.get("y", 0)) - int(prev_ai.get("y", 0))
        prev_dist = abs(prev_dx) + abs(prev_dy)
    if next_ai and next_target:
        next_dx = int(next_target.get("x", 0)) - int(next_ai.get("x", 0))
        next_dy = int(next_target.get("y", 0)) - int(next_ai.get("y", 0))
        next_dist = abs(next_dx) + abs(next_dy)
    if prev_ai and next_ai and prev_target and next_target:
        reward += float(prev_dist - next_dist) * 0.02
    if prev_ai and next_ai:
        if int(prev_ai.get("x", 0)) == int(next_ai.get("x", 0)) and int(prev_ai.get("y", 0)) == int(next_ai.get("y", 0)):
            reward -= 0.03
    prev_players = {p.get("id"): p for p in (prev_state.get("players") or []) if _is_player_tank(p)}
    next_players = {p.get("id"): p for p in (next_state.get("players") or []) if _is_player_tank(p)}
    player_hp_drop = 0
    for pid, prev_p in prev_players.items():
        next_p = next_players.get(pid)
        if not next_p:
            player_hp_drop += int(prev_p.get("health", 0))
        else:
            player_hp_drop += max(0, int(prev_p.get("health", 0)) - int(next_p.get("health", 0)))
    if player_hp_drop > 0:
        reward += float(player_hp_drop) * 1.5
    prev_ai_hp = int(prev_ai.get("health", 0)) if prev_ai else 0
    next_ai_hp = int(next_ai.get("health", 0)) if next_ai else 0
    ai_hp_drop = max(0, prev_ai_hp - next_ai_hp)
    if ai_hp_drop > 0:
        reward -= float(ai_hp_drop) * 1.0
    if next_state.get("gameOver"):
        reason = next_state.get("gameOverReason")
        if reason in ("player_destroyed", "hq_destroyed"):
            reward += 6.0
    return reward


async def _run_ai_session(session, session_id):
    ws_url = f"{GAME_BACKEND_WS_URL}?sessionId={session_id}"
    q_table = {}
    pending = {}
    epsilon = RL_EPSILON_START
    steps = 0
    episodes = 0
    last_loss = 0.0
    async with session.ws_connect(ws_url, heartbeat=20) as ws:
        await ws.send_json({"type": "join", "sessionId": session_id, "role": "ai"})
        print(f"[AI-Bridge] connected session {session_id}")
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                payload = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "transition":
                continue
            tick = payload.get("tick", 0)
            steps += 1
            if epsilon > RL_EPSILON_MIN:
                epsilon = max(RL_EPSILON_MIN, epsilon * RL_EPSILON_DECAY)
            if (payload.get("nextState") or {}).get("gameOver"):
                episodes += 1
            next_state = payload.get("nextState") or {}
            prev_state = payload.get("prevState") or {}
            players = next_state.get("players") or []
            ai_tanks = [p for p in players if _is_ai_tank(p) and int(p.get("health", 0)) > 0]
            player_tanks = [p for p in players if _is_player_tank(p) and int(p.get("health", 0)) > 0]
            prev_players = prev_state.get("players") or []
            prev_ai_map = {p.get("id"): p for p in prev_players if _is_ai_tank(p)}
            prev_player_tanks = [p for p in prev_players if _is_player_tank(p) and int(p.get("health", 0)) > 0]
            for ai_tank in ai_tanks:
                tank_id = ai_tank.get("id")
                prev_ai = prev_ai_map.get(tank_id) or ai_tank
                prev_target = _nearest_tank(prev_ai, prev_player_tanks)
                target = _nearest_tank(ai_tank, player_tanks)
                next_key = _state_key(ai_tank, target)
                reward_value = _compute_transition_reward(prev_ai, ai_tank, prev_target, target, prev_state, next_state)
                last = pending.get(tank_id)
                if last:
                    prev_key = last.get("state")
                    action_idx = int(last.get("action", 0))
                    q_prev = _ensure_q_row(q_table, prev_key)
                    q_next = _ensure_q_row(q_table, next_key)
                    best_next = max(q_next) if q_next else 0.0
                    old_q = q_prev[action_idx]
                    new_q = old_q + RL_ALPHA * (reward_value + RL_GAMMA * best_next - old_q)
                    q_prev[action_idx] = new_q
                    last_loss = abs(new_q - old_q)
                action_idx = _pick_action_index(q_table, next_key, epsilon)
                action = ACTION_MAP[action_idx]
                move = action.get("move")
                fire = bool(action.get("fire"))
                pending[tank_id] = {"state": next_key, "action": action_idx}
                dx = 0
                dy = 0
                target_id = "--"
                if target:
                    target_id = str(target.get("id", ""))[:6] or "--"
                    dx = int(target.get("x", 0) - ai_tank.get("x", 0))
                    dy = int(target.get("y", 0) - ai_tank.get("y", 0))
                action_text = move or ("fire" if fire else "idle")
                state_text = (
                    f"id={str(ai_tank.get('id',''))[:6]} "
                    f"self=({ai_tank.get('x',0)},{ai_tank.get('y',0)}) "
                    f"target={target_id} "
                    f"d=({dx},{dy}) "
                    f"k={next_key}"
                )
                await ws.send_json(
                    {
                        "type": "input",
                        "role": "ai",
                        "tankId": ai_tank.get("id"),
                        "move": move,
                        "fire": bool(fire),
                        "debug": {
                            "state": state_text,
                            "action": action_text,
                            "reward": reward_value,
                            "epsilon": epsilon,
                            "loss": last_loss,
                            "steps": steps if steps > tick else tick,
                            "episodes": episodes,
                            "buildState": True,
                            "sentObserve": True,
                            "workerAction": True,
                            "returnedAction": True,
                        },
                    }
                )


async def _ai_bridge_loop():
    print(f"[AI-Bridge] polling {GAME_BACKEND_URL}/sessions")
    tasks = {}
    timeout = aiohttp.ClientTimeout(total=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            try:
                async with session.get(f"{GAME_BACKEND_URL}/sessions") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        listed = {
                            s.get("sessionId")
                            for s in (data.get("sessions") or [])
                            if s.get("sessionId") and not s.get("gameOver")
                        }
                        for sid in listed:
                            if sid not in tasks or tasks[sid].done():
                                tasks[sid] = asyncio.create_task(_run_ai_session(session, sid))
                        stale = [sid for sid in tasks.keys() if sid not in listed]
                        for sid in stale:
                            task = tasks.pop(sid, None)
                            if task:
                                task.cancel()
            except Exception as error:
                print(f"[AI-Bridge] loop error: {error}")
            await asyncio.sleep(AI_POLL_INTERVAL_SECONDS)


def start_ai_bridge():
    def runner():
        try:
            asyncio.run(_ai_bridge_loop())
        except Exception as error:
            print(f"[AI-Bridge] stopped: {error}")
    thread = threading.Thread(target=runner, daemon=True, name="ai-bridge")
    thread.start()


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rl_models (
                model_key TEXT PRIMARY KEY,
                model_json TEXT NOT NULL,
                weight_specs TEXT NOT NULL,
                weight_data_base64 TEXT NOT NULL,
                training_config TEXT,
                metadata TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def map_key_from_record(model_key, metadata):
    if metadata and isinstance(metadata, dict) and metadata.get("mapKey"):
        return metadata.get("mapKey")
    if model_key and "-" in model_key:
        return model_key.split("-")[-1]
    return "default"


def rebuild_free_list():
    global FREE_LIST
    FREE_LIST = {}
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT model_key, metadata FROM rl_models"
        ).fetchall()
    for model_key, metadata_json in rows:
        metadata = None
        if metadata_json:
            try:
                metadata = json.loads(metadata_json)
            except json.JSONDecodeError:
                metadata = None
        map_key = map_key_from_record(model_key, metadata)
        FREE_LIST.setdefault(map_key, []).append(model_key)


def parse_json(body):
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, code, text):
        data = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, {"ok": True})
            return
        if parsed.path == "/api/rl-model-keys":
            query = parse_qs(parsed.query or "")
            filter_map = query.get("mapKey", [None])[0]
            with sqlite3.connect(DB_PATH) as conn:
                rows = conn.execute(
                    "SELECT model_key, metadata, updated_at FROM rl_models"
                ).fetchall()
            items = []
            for model_key, metadata_json, updated_at in rows:
                metadata = None
                if metadata_json:
                    try:
                        metadata = json.loads(metadata_json)
                    except json.JSONDecodeError:
                        metadata = None
                map_key = map_key_from_record(model_key, metadata)
                if filter_map and map_key != filter_map:
                    continue
                items.append(
                    {
                        "modelKey": model_key,
                        "mapKey": map_key,
                        "updatedAt": updated_at,
                    }
                )
            self._send_json(200, {"models": items})
            return
        if parsed.path.startswith("/api/rl-allocate/"):
            map_key = unquote(parsed.path.split("/api/rl-allocate/")[1])
            query = parse_qs(parsed.query or "")
            base_key = query.get("baseKey", [None])[0] or "tank-ai-dqn"
            free_list = FREE_LIST.get(map_key, [])
            if free_list:
                model_key = free_list.pop(0)
                LAST_POPPED[map_key] = model_key
                self._send_json(200, {"modelKey": model_key, "isNew": False})
                return
            suffix = datetime.now(datetime.UTC).strftime("%Y%m%d%H%M%S%f")
            model_key = f"{base_key}-{map_key}-{suffix}"
            copied_from = LAST_POPPED.get(map_key)
            if copied_from:
                with sqlite3.connect(DB_PATH) as conn:
                    row = conn.execute(
                        """
                        SELECT model_json, weight_specs, weight_data_base64,
                               training_config, metadata
                        FROM rl_models WHERE model_key = ?
                        """,
                        (copied_from,),
                    ).fetchone()
                if row:
                    model_json, weight_specs, weight_data, training_config, metadata = row
                    now = datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
                    with sqlite3.connect(DB_PATH) as conn:
                        conn.execute(
                            """
                            INSERT INTO rl_models (
                                model_key, model_json, weight_specs, weight_data_base64,
                                training_config, metadata, updated_at
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                model_key,
                                model_json,
                                weight_specs,
                                weight_data,
                                training_config,
                                metadata,
                                now,
                            ),
                        )
                        conn.commit()
                    self._send_json(
                        200,
                        {"modelKey": model_key, "isNew": True, "copiedFrom": copied_from},
                    )
                    return
            self._send_json(200, {"modelKey": model_key, "isNew": True})
            return
        if parsed.path.startswith("/api/rl-model/"):
            key = unquote(parsed.path.split("/api/rl-model/")[1])
            with sqlite3.connect(DB_PATH) as conn:
                row = conn.execute(
                    """
                    SELECT model_json, weight_specs, weight_data_base64,
                           training_config, metadata, updated_at
                    FROM rl_models WHERE model_key = ?
                    """,
                    (key,),
                ).fetchone()
            if not row:
                self._send_json(404, {"error": "Model not found"})
                return
            model_json, weight_specs, weight_data, training_config, metadata, updated_at = row
            self._send_json(
                200,
                {
                    "modelTopology": json.loads(model_json),
                    "weightSpecs": json.loads(weight_specs),
                    "weightDataBase64": weight_data,
                    "trainingConfig": json.loads(training_config) if training_config else None,
                    "userDefinedMetadata": json.loads(metadata) if metadata else None,
                    "updatedAt": updated_at,
                },
            )
            return
        self._send_text(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/rl-release/"):
            map_key = unquote(parsed.path.split("/api/rl-release/")[1])
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            payload = parse_json(body) or {}
            model_key = payload.get("modelKey")
            if not model_key:
                self._send_json(400, {"error": "Missing modelKey"})
                return
            FREE_LIST.setdefault(map_key, []).append(model_key)
            self._send_json(200, {"ok": True})
            return
        if parsed.path.startswith("/api/rl-model/"):
            key = unquote(parsed.path.split("/api/rl-model/")[1])
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            payload = parse_json(body) or {}
            model_topology = payload.get("modelTopology")
            weight_specs = payload.get("weightSpecs")
            weight_data_base64 = payload.get("weightDataBase64")
            if not model_topology or not weight_specs or not weight_data_base64:
                self._send_json(400, {"error": "Missing model data"})
                return
            now = datetime.utcnow().isoformat() + "Z"
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    """
                    INSERT INTO rl_models (
                        model_key, model_json, weight_specs, weight_data_base64,
                        training_config, metadata, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(model_key) DO UPDATE SET
                        model_json=excluded.model_json,
                        weight_specs=excluded.weight_specs,
                        weight_data_base64=excluded.weight_data_base64,
                        training_config=excluded.training_config,
                        metadata=excluded.metadata,
                        updated_at=excluded.updated_at
                    """,
                    (
                        key,
                        json.dumps(model_topology),
                        json.dumps(weight_specs),
                        weight_data_base64,
                        json.dumps(payload.get("trainingConfig"))
                        if payload.get("trainingConfig") is not None
                        else None,
                        json.dumps(payload.get("userDefinedMetadata"))
                        if payload.get("userDefinedMetadata") is not None
                        else None,
                        now,
                    ),
                )
                conn.commit()
            self._send_json(200, {"ok": True, "updatedAt": now})
            return
        self._send_text(404, "Not found")


def main():
    init_db()
    rebuild_free_list()
    server = HTTPServer((HOST, PORT), Handler)
    print(f"DeepRL backend listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
