import base64
import json
import os
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, unquote

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT_DIR, "rl-models.db")
HOST = "127.0.0.1"
PORT = int(os.getenv("PORT", "5050"))


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
    server = HTTPServer((HOST, PORT), Handler)
    print(f"DeepRL backend listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
