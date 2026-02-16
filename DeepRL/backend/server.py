import base64
import json
import os
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, unquote, parse_qs
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT_DIR.parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.append(str(SCRIPTS_DIR))
from shared_config import load_deploy_config  # noqa: E402

DEPLOY_CONFIG = load_deploy_config(
    required_keys=[
        "RL_DB_PATH",
        "RL_BACKEND_HOST",
        "RL_BACKEND_PORT",
    ]
)
_db_path_raw = str(DEPLOY_CONFIG.get("RL_DB_PATH") or "DeepRL/backend/rl-models.db")
DB_PATH = str((PROJECT_ROOT / _db_path_raw).resolve()) if not _db_path_raw.startswith("/") else _db_path_raw
HOST = str(DEPLOY_CONFIG.get("RL_BACKEND_HOST") or "127.0.0.1")
PORT = int(DEPLOY_CONFIG.get("RL_BACKEND_PORT") or 5050)
FREE_LIST = {}
LAST_POPPED = {}


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
        if parsed.path in ("/health", "/healthz"):
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
            suffix = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
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
                    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
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
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
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
