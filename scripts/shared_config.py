import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
PROFILE_FILE = CONFIG_DIR / "deploy.profile.json"
ALLOWED_PROFILES = {"local", "render"}


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_profile_name():
    if not PROFILE_FILE.exists():
        raise FileNotFoundError(
            f"Missing profile selector: {PROFILE_FILE}. "
            "Create config/deploy.profile.json with {\"profile\":\"local\"} or {\"profile\":\"render\"}."
        )
    payload = _read_json(PROFILE_FILE)
    profile = payload.get("profile") if isinstance(payload, dict) else None
    if not isinstance(profile, str) or profile not in ALLOWED_PROFILES:
        raise ValueError(
            f"Invalid profile in {PROFILE_FILE}. "
            f"Expected one of {sorted(ALLOWED_PROFILES)}, got {profile!r}."
        )
    return profile


def load_deploy_config(required_keys=None):
    profile = load_profile_name()
    deploy_file = CONFIG_DIR / f"deploy.{profile}.json"
    if not deploy_file.exists():
        raise FileNotFoundError(f"Missing deploy config file: {deploy_file}")

    payload = _read_json(deploy_file)
    if not isinstance(payload, dict):
        raise ValueError(f"Deploy config must be a JSON object: {deploy_file}")

    if required_keys:
        missing = [key for key in required_keys if key not in payload]
        if missing:
            raise ValueError(
                f"Missing keys in {deploy_file}: {', '.join(missing)}"
            )
    return payload

