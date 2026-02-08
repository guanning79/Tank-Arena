# Tank Editor

This tool manages a list of tank definitions stored in `tanks/tanks.json`.
It reads `TANK_DATA_ROOT` from `js/global-define.js` and falls back to `tanks/`.

## Tank Attributes

- `texture`: Path to a local `TANK_IMG_SIZE x TANK_IMG_SIZE` image stored under `TANK_DATA_ROOT` (`tanks/`).
- `tank_label`: Optional unique label (string, can be empty).
- `speed`: Integer, pixels per frame.
- `cooldown`: Integer, default `0`.
- `tank_hit_point`: Integer, default `1`.
- `bound_min`: Object with integer `x` and `y` for min pixel.
- `bound_max`: Object with integer `x` and `y` for max pixel.
- `shell_size`: Integer, one of `1`, `2`, `3`.
- `shell_speed`: Integer, pixels per frame.
- `shell_color`: One of `red`, `green`, `blue`.

## Data File

All tank data is persisted to `tanks/tanks.json`. Each entry is an object:

```
{
  "texture": "textures/basic.png",
  "tank_label": "player_basic",
  "speed": 6,
  "cooldown": 0,
  "tank_hit_point": 1,
  "bound_min": { "x": 2, "y": 1 },
  "bound_max": { "x": 29, "y": 30 },
  "shell_size": 2,
  "shell_speed": 9,
  "shell_color": "red"
}
```

## Usage

```
python tank_editor.py
python tank_editor.py gui
python tank_editor.py list
python tank_editor.py add --texture textures/basic.png --tank-label player_basic --speed 6 --cooldown 0 --tank-hit-point 1 --bound-min-x 2 --bound-min-y 1 --bound-max-x 29 --bound-max-y 30 --shell-size 2 --shell-speed 9 --shell-color red
python tank_editor.py remove 0
```
