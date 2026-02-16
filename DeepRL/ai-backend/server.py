import asyncio
import contextlib
import json as _json
import queue
import threading
import urllib.error
import urllib.request
import base64
import json
import os
import time
from datetime import datetime
from dataclasses import dataclass, field
import re
from pathlib import Path
from typing import Dict, List, Optional, Deque
from collections import deque
import importlib.util
import sys

import aiohttp
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
_shared_config_path = SCRIPTS_DIR / "shared_config.py"
_spec = importlib.util.spec_from_file_location("shared_config", _shared_config_path)
_shared_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_shared_config)  # type: ignore[union-attr]
load_deploy_config = _shared_config.load_deploy_config

DEPLOY_CONFIG = load_deploy_config(
    required_keys=[
        "GAME_BACKEND_URL",
        "GAME_BACKEND_WS_URL",
        "RL_DB_URL",
    ]
)
GAME_BACKEND_URL = str(DEPLOY_CONFIG.get("GAME_BACKEND_URL") or "http://127.0.0.1:5051").rstrip("/")
GAME_BACKEND_WS_URL = str(DEPLOY_CONFIG.get("GAME_BACKEND_WS_URL") or "ws://127.0.0.1:5051/ws").rstrip("/")
RL_DB_URL = str(DEPLOY_CONFIG.get("RL_DB_URL") or "http://127.0.0.1:5050").rstrip("/")
MODEL_BASE_KEY = os.getenv("RL_MODEL_BASE_KEY", "tank-ai-dqn")

POLL_INTERVAL = float(os.getenv("AI_POLL_INTERVAL", "2.0"))
LEARNING_RATE = float(os.getenv("AI_LEARNING_RATE", "0.001"))
GAMMA = float(os.getenv("AI_GAMMA", "0.95"))
EPSILON = float(os.getenv("AI_EPSILON_START", "0.2"))
EPSILON_MIN = float(os.getenv("AI_EPSILON_MIN", "0.05"))
EPSILON_DECAY = float(os.getenv("AI_EPSILON_DECAY", "0.9995"))

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

ACTION_MAP = [
    {"move": None, "fire": False},
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

RL_CONFIG_PATH = ROOT_DIR / "DeepRL" / "rl-config.js"


def load_rl_config():
    if not RL_CONFIG_PATH.exists():
        return {}
    text = RL_CONFIG_PATH.read_text(encoding="utf-8")
    def find_number(key, default):
        match = re.search(rf"{key}\s*:\s*([-0-9.]+)", text)
        return float(match.group(1)) if match else default
    def find_string_array(key):
        match = re.search(rf"{key}\s*:\s*\[([^\]]+)\]", text, re.S)
        if not match:
            return []
        raw = match.group(1)
        return [item.strip().strip("'\"") for item in raw.split(",") if item.strip()]
    def find_action_map():
        match = re.search(r"actionMap\s*:\s*\[(.*?)]", text, re.S)
        if not match:
            return []
        items = []
        for obj in re.findall(r"\{([^}]+)\}", match.group(1)):
            move_match = re.search(r"move\s*:\s*([^,]+)", obj)
            fire_match = re.search(r"fire\s*:\s*(true|false)", obj)
            move = move_match.group(1).strip() if move_match else "null"
            move = None if move == "null" else move.strip("'\"")
            fire = fire_match.group(1) == "true" if fire_match else False
            items.append({"move": move, "fire": fire})
        return items
    def find_reward_weights():
        match = re.search(r"rewardWeights\s*:\s*\{(.*?)\}", text, re.S)
        if not match:
            return {}
        weights = {}
        for line in match.group(1).splitlines():
            line = line.split("//", 1)[0].strip().strip(",")
            if not line:
                continue
            parts = line.split(":")
            if len(parts) < 2:
                continue
            key = parts[0].strip()
            try:
                value = float(parts[1].strip())
            except ValueError:
                continue
            weights[key] = value
        return weights

    return {
        "maxEnemySpeed": find_number("maxEnemySpeed", 4),
        "idleTickThreshold": find_number("idleTickThreshold", 20),
        "aimDotThreshold": find_number("aimDotThreshold", 0.85),
        "directionChangeCooldown": find_number("directionChangeCooldown", 6),
        "maxTileId": int(find_number("maxTileId", 7)),
        "saveEverySteps": int(find_number("saveEverySteps", 300)),
        "aiTankLabels": find_string_array("aiTankLabels"),
        "actionMap": find_action_map(),
        "rewardWeights": find_reward_weights(),
    }


RL_CONFIG = load_rl_config()
AI_TANK_LABELS = RL_CONFIG.get("aiTankLabels") or []
ACTION_MAP = RL_CONFIG.get("actionMap") or ACTION_MAP
SAVE_EVERY_STEPS = int(RL_CONFIG.get("saveEverySteps", 300))
MAX_ENEMY_SPEED = RL_CONFIG.get("maxEnemySpeed", 4)
IDLE_TICK_THRESHOLD = RL_CONFIG.get("idleTickThreshold", 20)
AIM_DOT_THRESHOLD = RL_CONFIG.get("aimDotThreshold", 0.85)
DIR_CHANGE_COOLDOWN = RL_CONFIG.get("directionChangeCooldown", 6)
MAX_TILE_ID = RL_CONFIG.get("maxTileId", 7)


def base64_encode(array: np.ndarray) -> str:
    return base64.b64encode(array.astype(np.float32).tobytes()).decode("utf-8")


def base64_decode(data: str) -> np.ndarray:
    raw = base64.b64decode(data.encode("utf-8"))
    return np.frombuffer(raw, dtype=np.float32).copy()


def get_map_key(map_name: Optional[str]) -> str:
    if not map_name:
        return "default"
    clean_name = map_name
    if clean_name.lower().startswith("maps/") or clean_name.lower().startswith("maps\\"):
        clean_name = clean_name[5:]
    if clean_name.lower().endswith(".json"):
        clean_name = clean_name[:-5]
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in clean_name).lower()


def map_key_from_model_key(model_key: Optional[str]) -> str:
    if model_key and "-" in model_key:
        return model_key.split("-")[-1]
    return get_map_key(model_key)


def compute_distance(x1, y1, x2, y2):
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


@dataclass
class LinearQModel:
    state_size: int
    action_size: int
    learning_rate: float = LEARNING_RATE
    gamma: float = GAMMA
    epsilon: float = EPSILON
    kernel: np.ndarray = field(init=False)
    bias: np.ndarray = field(init=False)
    steps: int = 0
    episodes: int = 0

    def __post_init__(self):
        self.kernel = np.random.randn(self.action_size, self.state_size).astype(np.float32) * 0.01
        self.bias = np.zeros(self.action_size, dtype=np.float32)

    def q_values(self, state: np.ndarray) -> np.ndarray:
        return self.kernel @ state + self.bias

    def choose_action(self, state: np.ndarray) -> int:
        if np.random.rand() < self.epsilon:
            return int(np.random.randint(0, self.action_size))
        return int(np.argmax(self.q_values(state)))

    def train(self, state: np.ndarray, action: int, reward: float, next_state: np.ndarray, done: bool):
        q = self.q_values(state)[action]
        target = reward
        if not done:
            target += self.gamma * float(np.max(self.q_values(next_state)))
        error = target - q
        self.kernel[action] += self.learning_rate * error * state
        self.bias[action] += self.learning_rate * error
        self.steps += 1
        self.epsilon = max(EPSILON_MIN, self.epsilon * EPSILON_DECAY)

    def to_payload(self):
        kernel_flat = self.kernel.reshape(-1)
        packed = np.concatenate([kernel_flat, self.bias])
        model_topology = {"format": "linear-q", "stateSize": self.state_size, "actionSize": self.action_size}
        weight_specs = [
            {"name": "kernel", "shape": [self.action_size, self.state_size], "dtype": "float32"},
            {"name": "bias", "shape": [self.action_size], "dtype": "float32"},
        ]
        return {
            "modelTopology": model_topology,
            "weightSpecs": weight_specs,
            "weightDataBase64": base64_encode(packed),
        }

    @classmethod
    def from_payload(cls, payload):
        model_topology = payload.get("modelTopology") or {}
        state_size = int(model_topology.get("stateSize", 0))
        action_size = int(model_topology.get("actionSize", 0))
        model = cls(state_size, action_size)
        data = base64_decode(payload.get("weightDataBase64", ""))
        kernel_size = action_size * state_size
        model.kernel = data[:kernel_size].reshape((action_size, state_size))
        model.bias = data[kernel_size:kernel_size + action_size]
        return model


@dataclass
class MlpQModel:
    state_size: int
    action_size: int
    hidden_size: int = 64
    learning_rate: float = LEARNING_RATE
    gamma: float = GAMMA
    epsilon: float = EPSILON
    w1: np.ndarray = field(init=False)
    b1: np.ndarray = field(init=False)
    w2: np.ndarray = field(init=False)
    b2: np.ndarray = field(init=False)
    steps: int = 0
    episodes: int = 0

    def __post_init__(self):
        self.w1 = (np.random.randn(self.hidden_size, self.state_size) * 0.01).astype(np.float32)
        self.b1 = np.zeros(self.hidden_size, dtype=np.float32)
        self.w2 = (np.random.randn(self.action_size, self.hidden_size) * 0.01).astype(np.float32)
        self.b2 = np.zeros(self.action_size, dtype=np.float32)

    def forward(self, state: np.ndarray):
        z1 = self.w1 @ state + self.b1
        a1 = np.maximum(z1, 0)
        q = self.w2 @ a1 + self.b2
        return z1, a1, q

    def q_values(self, state: np.ndarray) -> np.ndarray:
        return self.forward(state)[2]

    def choose_action(self, state: np.ndarray) -> int:
        if np.random.rand() < self.epsilon:
            return int(np.random.randint(0, self.action_size))
        return int(np.argmax(self.q_values(state)))

    def train(self, state: np.ndarray, action: int, reward: float, next_state: np.ndarray, done: bool):
        z1, a1, q = self.forward(state)
        target = reward
        if not done:
            target += self.gamma * float(np.max(self.q_values(next_state)))
        error = target - q[action]
        dq = np.zeros_like(q)
        dq[action] = error
        dw2 = np.outer(dq, a1)
        db2 = dq
        da1 = self.w2.T @ dq
        dz1 = da1 * (z1 > 0)
        dw1 = np.outer(dz1, state)
        db1 = dz1
        self.w2 += self.learning_rate * dw2
        self.b2 += self.learning_rate * db2
        self.w1 += self.learning_rate * dw1
        self.b1 += self.learning_rate * db1
        self.steps += 1
        self.epsilon = max(EPSILON_MIN, self.epsilon * EPSILON_DECAY)

    def to_payload(self):
        packed = np.concatenate(
            [self.w1.reshape(-1), self.b1, self.w2.reshape(-1), self.b2]
        )
        model_topology = {
            "format": "mlp-q",
            "stateSize": self.state_size,
            "actionSize": self.action_size,
            "hiddenSize": self.hidden_size,
        }
        weight_specs = [
            {"name": "w1", "shape": [self.hidden_size, self.state_size], "dtype": "float32"},
            {"name": "b1", "shape": [self.hidden_size], "dtype": "float32"},
            {"name": "w2", "shape": [self.action_size, self.hidden_size], "dtype": "float32"},
            {"name": "b2", "shape": [self.action_size], "dtype": "float32"},
        ]
        return {
            "modelTopology": model_topology,
            "weightSpecs": weight_specs,
            "weightDataBase64": base64_encode(packed),
        }

    @classmethod
    def from_payload(cls, payload):
        model_topology = payload.get("modelTopology") or {}
        state_size = int(model_topology.get("stateSize", 0))
        action_size = int(model_topology.get("actionSize", 0))
        hidden_size = int(model_topology.get("hiddenSize", 64))
        model = cls(state_size, action_size, hidden_size)
        data = base64_decode(payload.get("weightDataBase64", ""))
        w1_size = hidden_size * state_size
        b1_size = hidden_size
        w2_size = action_size * hidden_size
        model.w1 = data[:w1_size].reshape((hidden_size, state_size))
        offset = w1_size
        model.b1 = data[offset:offset + b1_size]
        offset += b1_size
        model.w2 = data[offset:offset + w2_size].reshape((action_size, hidden_size))
        offset += w2_size
        model.b2 = data[offset:offset + action_size]
        return model


@dataclass
class SessionState:
    session_id: str
    model_key: str
    base_model_key: str
    map_name: str
    map_key: str
    ws: Optional[aiohttp.ClientWebSocketResponse] = None
    state: Optional[dict] = None
    model: Optional[object] = None
    map_data: Optional[dict] = None
    ai_runtime: Dict[str, dict] = field(default_factory=dict)
    last_step: int = 0
    last_action_tick: Optional[int] = None
    transitions_received: int = 0
    actions_generated: int = 0
    last_td_loss: Optional[float] = None
    last_q_mean: Optional[float] = None
    episode_start_tick: Optional[int] = None
    episode_reward_sum: float = 0.0
    episode_return_total: float = 0.0
    last_game_over: bool = False
    last_episode_log: Optional[str] = None
    last_episode_log_tick: Optional[int] = None
    state_history: Dict[str, Deque[np.ndarray]] = field(default_factory=dict)


class AiBackend:
    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}
        self.http = aiohttp.ClientSession()
        self.model_pool: Dict[str, List[str]] = {}
        self.models: Dict[str, object] = {}
        self.latest_saved_by_base_key: Dict[str, str] = {}
        self.persist_queue = queue.Queue()
        self.persist_thread = threading.Thread(
            target=self._persist_worker,
            daemon=True,
            name="ai-model-persist",
        )
        self.persist_thread.start()
    def _persist_worker(self):
        while True:
            item = self.persist_queue.get()
            if item is None:
                break
            url, payload_json, session = item
            save_start = time.perf_counter()
            data = payload_json.encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp.read()
                if session:
                    session.last_async_save_ms = (time.perf_counter() - save_start) * 1000
            except urllib.error.URLError:
                pass
            finally:
                self.persist_queue.task_done()

    async def close(self):
        await self.http.close()

    async def fetch_sessions(self):
        async with self.http.get(f"{GAME_BACKEND_URL}/sessions") as resp:
            data = await resp.json()
            return data.get("sessions", [])

    async def load_model_by_key(self, model_key: str):
        try:
            async with self.http.get(f"{RL_DB_URL}/api/rl-model/{model_key}") as resp:
                if resp.status != 200:
                    return None
                payload = await resp.json()
                model_topology = payload.get("modelTopology") or {}
                fmt = model_topology.get("format")
                if fmt == "mlp-q":
                    return MlpQModel.from_payload(payload)
                if fmt == "linear-q":
                    return LinearQModel.from_payload(payload)
        except Exception:
            return None
        return None

    def clone_model(self, model: object):
        if isinstance(model, MlpQModel):
            cloned = MlpQModel(model.state_size, model.action_size, model.hidden_size)
            cloned.w1 = np.array(model.w1, copy=True)
            cloned.b1 = np.array(model.b1, copy=True)
            cloned.w2 = np.array(model.w2, copy=True)
            cloned.b2 = np.array(model.b2, copy=True)
            cloned.steps = model.steps
            cloned.episodes = model.episodes
            cloned.epsilon = model.epsilon
            return cloned
        if isinstance(model, LinearQModel):
            cloned = LinearQModel(model.state_size, model.action_size)
            cloned.kernel = np.array(model.kernel, copy=True)
            cloned.bias = np.array(model.bias, copy=True)
            cloned.steps = model.steps
            cloned.episodes = model.episodes
            cloned.epsilon = model.epsilon
            return cloned
        return None

    def parse_updated_at(self, value: Optional[str]) -> float:
        if not value:
            return 0.0
        try:
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return datetime.fromisoformat(value).timestamp()
        except Exception:
            return 0.0

    async def load_model_catalog(self):
        try:
            async with self.http.get(f"{RL_DB_URL}/api/rl-model-keys") as resp:
                if resp.status != 200:
                    return
                payload = await resp.json()
                entries = payload.get("models", [])
        except Exception:
            return
        updated_at_map = {}
        for entry in entries:
            model_key = entry.get("modelKey")
            if not model_key:
                continue
            updated_at_map[model_key] = self.parse_updated_at(entry.get("updatedAt"))
        for entry in entries:
            model_key = entry.get("modelKey")
            if not model_key:
                continue
            map_key = entry.get("mapKey") or map_key_from_model_key(model_key)
            base_model_key = f"{MODEL_BASE_KEY}-{map_key}"
            model = await self.load_model_by_key(model_key)
            if not model:
                continue
            self.models[model_key] = model
            self.model_pool.setdefault(base_model_key, []).append(model_key)
            updated_at = updated_at_map.get(model_key, 0.0)
            latest_key = self.latest_saved_by_base_key.get(base_model_key)
            if not latest_key:
                self.latest_saved_by_base_key[base_model_key] = model_key
            else:
                latest_time = updated_at_map.get(latest_key, 0.0)
                if updated_at >= latest_time:
                    self.latest_saved_by_base_key[base_model_key] = model_key

    def allocate_model_instance(self, base_model_key: str):
        pool = self.model_pool.get(base_model_key, [])
        while pool:
            model_key = pool.pop(0)
            model = self.models.get(model_key)
            if model:
                return model_key, model
            continue
        latest_key = self.latest_saved_by_base_key.get(base_model_key)
        if latest_key:
            latest_model = self.models.get(latest_key)
            if latest_model:
                timestamp = int(time.time() * 1000)
                new_key = f"{base_model_key}-{timestamp}"
                cloned = self.clone_model(latest_model)
                if cloned:
                    self.models[new_key] = cloned
                    return new_key, cloned
        return None, None

    def get_model_pool_counts(self, base_model_key: str):
        if not base_model_key:
            return 0, 0, 0
        available = len(self.model_pool.get(base_model_key, []))
        prefix = f"{base_model_key}-"
        total = sum(
            1 for key in self.models.keys()
            if key == base_model_key or key.startswith(prefix)
        )
        in_use = sum(
            1 for session in self.sessions.values()
            if session.base_model_key == base_model_key
        )
        return available, total, in_use

    def get_model_instance_brief(self):
        items = []
        for session in self.sessions.values():
            ws = session.ws
            ws_id = str(id(ws)) if ws else None
            if ws is None:
                state = "none"
            else:
                state = "closed" if ws.closed else "open"
            items.append(
                {
                    "sessionId": session.session_id,
                    "wsId": ws_id,
                    "state": state,
                }
            )
        return items

    def get_model_memory_bytes(self, model: object) -> int:
        if isinstance(model, MlpQModel):
            return int(model.w1.nbytes + model.b1.nbytes + model.w2.nbytes + model.b2.nbytes)
        if isinstance(model, LinearQModel):
            return int(model.kernel.nbytes + model.bias.nbytes)
        return 0

    def get_history_memory_bytes(self, session: SessionState) -> int:
        total = 0
        for items in session.state_history.values():
            for state in items:
                total += int(state.nbytes)
        return total

    def release_model_instance(self, base_model_key: str, model_key: str):
        if not base_model_key or not model_key:
            return
        pool = self.model_pool.setdefault(base_model_key, [])
        if model_key not in pool:
            pool.append(model_key)

    async def ensure_session(self, entry):
        session_id = entry.get("sessionId")
        if not session_id:
            return
        if session_id in self.sessions:
            return
        map_name = entry.get("mapName") or "Stage03.json"
        map_key = entry.get("mapKey") or get_map_key(map_name)
        base_model_key = entry.get("modelKey") or f"{MODEL_BASE_KEY}-{map_key}"
        model_key, model = self.allocate_model_instance(base_model_key)
        if not model_key:
            timestamp = int(time.time() * 1000)
            model_key = f"{base_model_key}-{timestamp}"
        session = SessionState(
            session_id=session_id,
            model_key=model_key,
            base_model_key=base_model_key,
            map_name=map_name,
            map_key=map_key,
        )
        session.model = model
        self.sessions[session_id] = session
        await self.connect_ws(session)
        if not session.model:
            await self.load_model(session)

    def load_map_data(self, map_name: str) -> Optional[dict]:
        if not map_name:
            return None
        clean_name = map_name
        if clean_name.lower().startswith("maps/") or clean_name.lower().startswith("maps\\"):
            clean_name = clean_name[5:]
        map_path = ROOT_DIR / "maps" / clean_name
        if not map_path.exists():
            return None
        data = json.loads(map_path.read_text(encoding="utf-8"))
        return data

    def ensure_map_data(self, session: SessionState, state: dict):
        map_name = state.get("mapName") or session.map_name
        if session.map_data and session.map_data.get("name") == map_name:
            return
        session.map_data = self.load_map_data(map_name)
        session.map_name = map_name

    async def connect_ws(self, session: SessionState):
        if session.ws is not None and not session.ws.closed:
            with contextlib.suppress(Exception):
                await session.ws.close()
        ws = await self.http.ws_connect(f"{GAME_BACKEND_WS_URL}?sessionId={session.session_id}")
        session.ws = ws
        await ws.send_json({"type": "join", "role": "ai", "sessionId": session.session_id})
        asyncio.create_task(self.listen_ws(session))

    async def load_model(self, session: SessionState):
        try:
            async with self.http.get(f"{RL_DB_URL}/api/rl-model/{session.model_key}") as resp:
                if resp.status != 200:
                    return
                payload = await resp.json()
                model_topology = payload.get("modelTopology") or {}
                fmt = model_topology.get("format")
                if fmt == "mlp-q":
                    session.model = MlpQModel.from_payload(payload)
                elif fmt == "linear-q":
                    session.model = LinearQModel.from_payload(payload)
                else:
                    session.model = None
                if session.model:
                    self.models[session.model_key] = session.model
        except Exception:
            return

    async def save_model(self, session: SessionState):
        if not session.model:
            return
        payload = session.model.to_payload()
        payload["userDefinedMetadata"] = {
            "mapKey": session.map_key,
        }
        url = f"{RL_DB_URL}/api/rl-model/{session.model_key}"
        payload_json = _json.dumps(payload)
        self.persist_queue.put((url, payload_json, session))
        print(f"[ai-backend] queued save {session.model_key} steps={session.model.steps}")
        self.latest_saved_by_base_key[session.base_model_key] = session.model_key
        session.last_async_save_ms = None

    def build_state_vector(self, tank, player):
        return np.array([], dtype=np.float32)

    def select_player(self, state):
        players = [t for t in state.get("players", []) if t.get("role") == "player"]
        if not players:
            return None
        return players[0]

    def get_hq_center(self, map_data: dict) -> Optional[dict]:
        if not map_data:
            return None
        tiles = map_data.get("tiles") or []
        tile_size = map_data.get("tileSize", 0)
        for row in range(len(tiles)):
            for col in range(len(tiles[row])):
                if tiles[row][col] == TILE_TYPES["PLAYER_HQ"]:
                    return {"x": col * tile_size + tile_size / 2, "y": row * tile_size + tile_size / 2}
        return None

    def has_line_of_sight(self, map_data: dict, from_x: float, from_y: float, to_x: float, to_y: float) -> int:
        if not map_data:
            return 0
        tiles = map_data.get("tiles") or []
        tile_size = map_data.get("tileSize", 0)
        start_col = int(from_x // tile_size)
        start_row = int(from_y // tile_size)
        end_col = int(to_x // tile_size)
        end_row = int(to_y // tile_size)
        dx = abs(end_col - start_col)
        dy = abs(end_row - start_row)
        sx = 1 if start_col < end_col else -1
        sy = 1 if start_row < end_row else -1
        err = dx - dy
        x = start_col
        y = start_row
        while True:
            if 0 <= y < len(tiles) and 0 <= x < len(tiles[y]):
                tile_id = tiles[y][x]
                if TILE_PROPERTIES.get(tile_id, {}).get("blocksBullet"):
                    return 0
            if x == end_col and y == end_row:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x += sx
            if e2 < dx:
                err += dx
                y += sy
        return 1

    def update_ai_runtime(self, session: SessionState, tank: dict):
        meta = session.ai_runtime.get(tank["id"]) or {"idleTicks": 0, "prevX": tank["x"], "prevY": tank["y"]}
        moved = (tank["x"] != meta.get("prevX")) or (tank["y"] != meta.get("prevY"))
        meta["idleTicks"] = 0 if moved else int(meta.get("idleTicks", 0)) + 1
        meta["prevX"] = tank["x"]
        meta["prevY"] = tank["y"]
        session.ai_runtime[tank["id"]] = meta
        return meta

    def build_full_state_vector(self, session: SessionState, tank: dict, player: Optional[dict]) -> np.ndarray:
        map_data = session.map_data or {}
        tile_size = map_data.get("tileSize", 1)
        map_size = map_data.get("mapSize", 1)
        hq_center = self.get_hq_center(map_data)
        runtime = self.update_ai_runtime(session, tank)
        player_dx = (player["x"] - tank["x"]) if player else 0
        player_dy = (player["y"] - tank["y"]) if player else 0
        player_dist = compute_distance(tank["x"], tank["y"], player["x"], player["y"]) if player else 0
        hq_dx = (hq_center["x"] - tank["x"]) if hq_center else 0
        hq_dy = (hq_center["y"] - tank["y"]) if hq_center else 0
        hq_dist = compute_distance(tank["x"], tank["y"], hq_center["x"], hq_center["y"]) if hq_center else 0
        player_los = self.has_line_of_sight(map_data, tank["x"], tank["y"], player["x"], player["y"]) if player else 0
        hq_los = self.has_line_of_sight(map_data, tank["x"], tank["y"], hq_center["x"], hq_center["y"]) if hq_center else 0
        type_index = AI_TANK_LABELS.index(tank.get("label")) if tank.get("label") in AI_TANK_LABELS else 0
        type_norm = type_index / (len(AI_TANK_LABELS) - 1) if len(AI_TANK_LABELS) > 1 else 0
        tile_col = int(tank["x"] // tile_size)
        tile_row = int(tank["y"] // tile_size)
        tiles = map_data.get("tiles") or []
        tile_features = []
        for row_offset in range(-1, 2):
            for col_offset in range(-1, 2):
                row = tile_row + row_offset
                col = tile_col + col_offset
                tile_id = tiles[row][col] if 0 <= row < len(tiles) and 0 <= col < len(tiles[row]) else None
                value = (tile_id + 1) / (MAX_TILE_ID + 1) if isinstance(tile_id, int) else 0
                tile_features.append(value)
        features = [
            tank["x"] / map_size,
            tank["y"] / map_size,
            tank.get("dirX", 0),
            tank.get("dirY", 0),
            (tank.get("speed", 0) / max(MAX_ENEMY_SPEED, 1)),
            (tank.get("health", 0) / max(tank.get("maxHealth", 1), 1)),
            (tank.get("shootCooldown", 0) / max(tank.get("cooldown", 1), 1)),
            player_dx / map_size,
            player_dy / map_size,
            player_dist / map_size,
            player_los,
            (player.get("health", 0) / max(player.get("maxHealth", 1), 1)) if player else 0,
            hq_dx / map_size,
            hq_dy / map_size,
            hq_dist / map_size,
            hq_los,
            runtime.get("idleTicks", 0) / max(IDLE_TICK_THRESHOLD, 1),
            type_norm,
        ] + tile_features
        return np.array(features, dtype=np.float32)

    def build_stacked_state_vector(self, session: SessionState, tank: dict, player: Optional[dict]) -> np.ndarray:
        current = self.build_full_state_vector(session, tank, player)
        history = session.state_history.get(tank["id"])
        if history is None:
            history = deque(maxlen=4)
            session.state_history[tank["id"]] = history
        history.append(current)
        if len(history) < 4:
            pad_count = 4 - len(history)
            pad = [np.zeros_like(current) for _ in range(pad_count)]
            stacked = pad + list(history)
        else:
            stacked = list(history)
        return np.concatenate(stacked, axis=0)

    def apply_delta(self, base, delta):
        if not base or not delta:
            return delta
        if delta.get("mapName"):
            base["mapName"] = delta["mapName"]
        if "players" in delta:
            prev = {p["id"]: p for p in base.get("players", [])}
            for item in delta["players"].get("upserts", []):
                prev[item["id"]] = item
            for rid in delta["players"].get("removed", []):
                prev.pop(rid, None)
            base["players"] = list(prev.values())
        if "bullets" in delta:
            prev = {b["id"]: b for b in base.get("bullets", [])}
            for item in delta["bullets"].get("upserts", []):
                prev[item["id"]] = item
            for rid in delta["bullets"].get("removed", []):
                prev.pop(rid, None)
            base["bullets"] = list(prev.values())
        if "aiDebug" in delta:
            base["aiDebug"] = delta["aiDebug"]
        if "mapTiles" in delta:
            base["mapTiles"] = delta["mapTiles"]
        if "mapTilesChanged" in delta:
            base["mapTilesChanged"] = delta["mapTilesChanged"]
        base["tick"] = delta.get("tick", base.get("tick", 0))
        return base

    def apply_map_updates(self, session: SessionState, updates):
        if not updates or not session.map_data:
            return
        tiles = session.map_data.get("tiles") or []
        for item in updates:
            try:
                row = int(item.get("row"))
                col = int(item.get("col"))
                tile_id = item.get("tileId")
            except (TypeError, ValueError):
                continue
            if row < 0 or col < 0:
                continue
            if row >= len(tiles) or col >= len(tiles[row]):
                continue
            tiles[row][col] = tile_id
        session.map_data["tiles"] = tiles

    async def handle_transition(self, session: SessionState, payload: dict):
        prev_state = payload.get("prevState")
        next_state = payload.get("nextState")
        tick = payload.get("tick")
        session.transitions_received += 1
        if session.state is None:
            session.state = prev_state or next_state
        if next_state and next_state.get("delta"):
            session.state = self.apply_delta(session.state, next_state)
        elif next_state:
            session.state = next_state
        state = session.state or {}
        self.ensure_map_data(session, state)
        updates = state.get("mapTilesChanged") or next_state.get("mapTilesChanged") if isinstance(next_state, dict) else None
        if updates:
            self.apply_map_updates(session, updates)
        ai_rewards = payload.get("aiRewards", [])
        reward_count = len(ai_rewards) if isinstance(ai_rewards, list) else 0
        reward_sum = 0.0
        if isinstance(ai_rewards, list):
            for entry in ai_rewards:
                try:
                    reward_sum += float(entry.get("reward", 0))
                except (TypeError, ValueError):
                    continue
        if session.episode_start_tick is None and isinstance(tick, int):
            session.episode_start_tick = tick
        session.episode_reward_sum += reward_sum
        ai_tanks = [t for t in state.get("players", []) if t.get("role") == "ai"]
        player = self.select_player(state)
        if ai_tanks:
            sample_state = self.build_stacked_state_vector(session, ai_tanks[0], player)
            expected_size = sample_state.shape[0]
            if session.model and getattr(session.model, "state_size", None) != expected_size:
                session.model = None
                session.state_history = {}
                sample_state = self.build_stacked_state_vector(session, ai_tanks[0], player)
                expected_size = sample_state.shape[0]
            if not session.model:
                session.model = MlpQModel(state_size=expected_size, action_size=len(ACTION_MAP), hidden_size=64)
        if session.model:
            train_start = time.perf_counter()
            steps_before = session.model.steps
            train_state_bytes = 0
            td_errors = []
            q_means = []
            for entry in ai_rewards:
                tank = next((t for t in ai_tanks if t["id"] == entry.get("tankId")), None)
                if not tank:
                    continue
                state_vec = self.build_stacked_state_vector(session, tank, player)
                next_state_vec = state_vec.copy()
                train_state_bytes += int(state_vec.nbytes + next_state_vec.nbytes)
                reward = float(entry.get("reward", 0))
                done = False
                action = session.model.choose_action(state_vec)
                q_values = session.model.q_values(state_vec)
                next_q_values = session.model.q_values(next_state_vec)
                target = reward
                if not done:
                    target += session.model.gamma * float(np.max(next_q_values))
                td_error = target - float(q_values[action])
                td_errors.append(td_error)
                q_means.append(float(np.mean(q_values)))
                session.model.train(state_vec, action, reward, next_state_vec, done)
            steps_after = session.model.steps
            train_steps_delta = steps_after - steps_before
            session.last_train_ms = (time.perf_counter() - train_start) * 1000
            session.last_train_state_bytes = train_state_bytes
            if td_errors:
                session.last_td_loss = float(np.mean(np.square(td_errors)))
            if q_means:
                session.last_q_mean = float(np.mean(q_means))
            if session.model.steps - session.last_step >= SAVE_EVERY_STEPS:
                await self.save_model(session)
                session.last_step = session.model.steps
        else:
            train_steps_delta = 0
        game_over = bool(state.get("gameOver"))
        if game_over and not session.last_game_over:
            if session.model:
                session.model.episodes += 1
            session.episode_return_total += session.episode_reward_sum
            avg_return = session.episode_return_total / max((session.model.episodes if session.model else 1), 1)
            time_to_win = None
            if isinstance(tick, int) and isinstance(session.episode_start_tick, int):
                reason = state.get("gameOverReason")
                if reason in ("player_destroyed", "hq_destroyed"):
                    time_to_win = tick - session.episode_start_tick
            session.last_episode_log = (
                f"episode={session.model.episodes if session.model else 0} "
                f"avgReward={avg_return:.2f} timeToWin={time_to_win if time_to_win is not None else '--'}"
            )
            session.last_episode_log_tick = tick
            if session.ws and not session.ws.closed:
                await session.ws.send_json({
                    "type": "episode_log",
                    "episodeLog": session.last_episode_log,
                    "episodeLogTick": session.last_episode_log_tick,
                })
        if not game_over and session.last_game_over:
            if isinstance(tick, int):
                session.episode_start_tick = tick
            session.episode_reward_sum = 0.0
        session.last_game_over = game_over
        if tick is None or tick != session.last_action_tick:
            actions_sent = await self.send_actions(session, ai_tanks, player, ai_rewards, tick)
            session.actions_generated += actions_sent
            if isinstance(tick, int):
                session.last_action_tick = tick
        session.last_reward_count = reward_count
        session.last_reward_sum = reward_sum
        session.last_train_steps = train_steps_delta

    async def send_actions(self, session: SessionState, ai_tanks: List[dict], player: Optional[dict], rewards, tick):
        if not session.ws:
            return 0
        pool_available, pool_total, pool_in_use = self.get_model_pool_counts(session.base_model_key)
        model_instances = self.get_model_instance_brief()
        sent_count = 0
        infer_start = time.perf_counter()
        for tank in ai_tanks:
            state_vec = self.build_stacked_state_vector(session, tank, player)
            action = session.model.choose_action(state_vec) if session.model else 0
            action_def = ACTION_MAP[action]
            debug = {
                "reward": rewards[0].get("reward") if rewards else 0,
                "rewardReasons": rewards[0].get("rewardReasons") if rewards else ["none"],
                "steps": session.model.steps if session.model else 0,
                "episodes": session.model.episodes if session.model else 0,
                "epsilon": session.model.epsilon if session.model else 0,
                "state": tank["id"],
                "action": action,
                "modelPoolAvailable": pool_available,
                "modelPoolTotal": pool_total,
                "modelPoolInUse": pool_in_use,
                "transitionsReceived": session.transitions_received,
                "actionsGenerated": session.actions_generated,
                "actionTick": tick,
                "modelInstancesBrief": model_instances,
                "rewardBatchCount": getattr(session, "last_reward_count", 0),
                "rewardBatchSum": getattr(session, "last_reward_sum", 0.0),
                "trainStepsDelta": getattr(session, "last_train_steps", 0),
                "tdLoss": session.last_td_loss,
                "qMean": session.last_q_mean,
                "perfTrainMs": getattr(session, "last_train_ms", 0.0),
                "perfInferMs": getattr(session, "last_infer_ms", 0.0),
                "asyncSaveMs": getattr(session, "last_async_save_ms", 0.0),
                "memModelBytes": self.get_model_memory_bytes(session.model) if session.model else 0,
                "memTrainStateBytes": getattr(session, "last_train_state_bytes", 0),
                "memHistoryBytes": self.get_history_memory_bytes(session),
            }
            await session.ws.send_json(
                {
                    "type": "input",
                    "role": "ai",
                    "tankId": tank["id"],
                    "move": action_def["move"],
                    "fire": action_def["fire"],
                    "debug": debug,
                }
            )
            sent_count += 1
        infer_ms = (time.perf_counter() - infer_start) * 1000
        session.last_infer_ms = infer_ms
        return sent_count

    async def listen_ws(self, session: SessionState):
        try:
            async for msg in session.ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    payload = json.loads(msg.data)
                    if payload.get("type") == "transition":
                        await self.handle_transition(session, payload)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    break
        finally:
            if session.ws and not session.ws.closed:
                with contextlib.suppress(Exception):
                    await session.ws.close()
            session.ws = None
            if session.session_id in self.sessions:
                with contextlib.suppress(Exception):
                    await self.connect_ws(session)

    async def run(self):
        while True:
            try:
                sessions = await self.fetch_sessions()
                active_ids = {entry.get("sessionId") for entry in sessions if entry.get("sessionId")}
                for entry in sessions:
                    await self.ensure_session(entry)
                for session_id in list(self.sessions.keys()):
                    if session_id not in active_ids:
                        session = self.sessions.pop(session_id)
                        if session.ws and not session.ws.closed:
                            with contextlib.suppress(Exception):
                                await session.ws.close()
                            session.ws = None
                        self.release_model_instance(session.base_model_key, session.model_key)
            except Exception:
                pass
            await asyncio.sleep(POLL_INTERVAL)


async def main():
    backend = AiBackend()
    try:
        await backend.load_model_catalog()
        await backend.run()
    finally:
        await backend.close()


if __name__ == "__main__":
    asyncio.run(main())
