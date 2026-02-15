import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROFILE_PATH = PROJECT_ROOT / "config" / "deploy.profile.json"
ALLOWED = {"local", "render"}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/set_deploy_profile.py <local|render>")
    profile = sys.argv[1].strip()
    if profile not in ALLOWED:
        raise SystemExit(f"Invalid profile '{profile}'. Expected one of: {', '.join(sorted(ALLOWED))}")
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_PATH.write_text(json.dumps({"profile": profile}, indent=2) + "\n", encoding="utf-8")
    print(f"deploy profile set to '{profile}' at {PROFILE_PATH}")


if __name__ == "__main__":
    main()
