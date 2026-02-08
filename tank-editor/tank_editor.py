import argparse
import json
import re
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_DEFINE_FILE = REPO_ROOT / "js" / "global-define.js"


def read_global_defines() -> str:
    if not GLOBAL_DEFINE_FILE.exists():
        return ""
    try:
        return GLOBAL_DEFINE_FILE.read_text(encoding="utf-8")
    except OSError:
        return ""


def load_global_string(name: str, fallback: str) -> str:
    content = read_global_defines()
    match = re.search(rf"{re.escape(name)}\s*=\s*['\"]([^'\"]+)['\"]", content)
    return match.group(1) if match else fallback


def load_global_int(name: str, fallback: int) -> int:
    content = read_global_defines()
    match = re.search(rf"{re.escape(name)}\s*=\s*(\d+)", content)
    if not match:
        return fallback
    try:
        value = int(match.group(1))
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def load_tank_data_root() -> Path:
    value = load_global_string("TANK_DATA_ROOT", "tanks")
    candidate = (REPO_ROOT / value).resolve()
    try:
        candidate.relative_to(REPO_ROOT.resolve())
    except ValueError:
        return REPO_ROOT / "tanks"
    return candidate


TANK_DATA_ROOT = load_tank_data_root()
TANK_IMG_SIZE = load_global_int("TANK_IMG_SIZE", 32)
DATA_FILE = TANK_DATA_ROOT / "tanks.json"

SHELL_SIZES = {1, 2, 3}
SHELL_COLORS = ["red", "green", "blue"]


def ensure_data_root() -> None:
    TANK_DATA_ROOT.mkdir(parents=True, exist_ok=True)


def load_data() -> list:
    if not DATA_FILE.exists():
        return []
    try:
        with DATA_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {DATA_FILE}") from exc
    if not isinstance(data, list):
        raise ValueError(f"Expected a list in {DATA_FILE}")
    return data


def save_data(data: list) -> None:
    ensure_data_root()
    with DATA_FILE.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def normalize_texture_path(value: str) -> str:
    if not value:
        raise ValueError("Texture path is required.")
    texture_path = Path(value)
    if not texture_path.is_absolute():
        texture_path = (TANK_DATA_ROOT / texture_path).resolve()
    else:
        texture_path = texture_path.resolve()
    data_root = TANK_DATA_ROOT.resolve()
    try:
        relative_path = texture_path.relative_to(data_root)
    except ValueError as exc:
        raise ValueError("Texture must be located inside TANK_DATA_ROOT.") from exc
    return relative_path.as_posix()


def validate_shell_size(value: int) -> int:
    if value not in SHELL_SIZES:
        raise ValueError(f"shell_size must be one of {sorted(SHELL_SIZES)}")
    return value


def validate_shell_color(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in SHELL_COLORS:
        raise ValueError(f"shell_color must be one of {SHELL_COLORS}")
    return normalized


def validate_positive_int(name: str, value: int, minimum: int = 0) -> int:
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}")
    return value


def validate_unique_label(label: str, data: list, ignore_index: int = None) -> None:
    if not label:
        return
    normalized = label.strip().lower()
    for index, tank in enumerate(data):
        if ignore_index is not None and index == ignore_index:
            continue
        existing = str(tank.get("tank_label", "")).strip().lower()
        if existing and existing == normalized:
            raise ValueError(f"tank_label '{label}' already exists.")


def list_tanks(data: list) -> None:
    if not data:
        print("No tanks found.")
        return
    for index, tank in enumerate(data):
        tank_label = tank.get("tank_label", "")
        bound_min = tank.get("bound_min", {})
        bound_max = tank.get("bound_max", {})
        min_x = bound_min.get("x", "?")
        min_y = bound_min.get("y", "?")
        max_x = bound_max.get("x", "?")
        max_y = bound_max.get("y", "?")
        print(
            f"[{index}] label={tank_label} "
            f"texture={tank.get('texture')} "
            f"speed={tank.get('speed')} "
            f"cooldown={tank.get('cooldown', '?')} "
            f"hp={tank.get('tank_hit_point', '?')} "
            f"bound_min=({min_x},{min_y}) "
            f"bound_max=({max_x},{max_y}) "
            f"shell_size={tank.get('shell_size')} "
            f"shell_speed={tank.get('shell_speed')} "
            f"shell_color={tank.get('shell_color')}"
        )


def format_tank_line(index: int, tank: dict) -> str:
    tank_label = tank.get("tank_label", "")
    bound_min = tank.get("bound_min", {})
    bound_max = tank.get("bound_max", {})
    min_x = bound_min.get("x", "?")
    min_y = bound_min.get("y", "?")
    max_x = bound_max.get("x", "?")
    max_y = bound_max.get("y", "?")
    return (
        f"[{index}] label={tank_label} "
        f"texture={tank.get('texture')} "
        f"speed={tank.get('speed')} "
        f"cooldown={tank.get('cooldown', '?')} "
        f"hp={tank.get('tank_hit_point', '?')} "
        f"bound_min=({min_x},{min_y}) "
        f"bound_max=({max_x},{max_y}) "
        f"shell_size={tank.get('shell_size')} "
        f"shell_speed={tank.get('shell_speed')} "
        f"shell_color={tank.get('shell_color')}"
    )


class TankEditorGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Tank Editor")
        self.data = load_data()

        self.listbox = None
        self.texture_image = None
        self.texture_preview = None
        self.texture_path_label = None
        self.tank_label_var = tk.StringVar()
        self.texture_var = tk.StringVar()
        self.speed_var = tk.StringVar()
        self.cooldown_var = tk.StringVar(value="0")
        self.hit_point_var = tk.StringVar(value="1")
        self.bound_min_x_var = tk.StringVar()
        self.bound_min_y_var = tk.StringVar()
        self.bound_max_x_var = tk.StringVar()
        self.bound_max_y_var = tk.StringVar()
        self.shell_size_var = tk.StringVar(value="1")
        self.shell_speed_var = tk.StringVar()
        self.shell_color_var = tk.StringVar(value=SHELL_COLORS[0])

        self.texture_var.trace_add("write", lambda *_: self.on_texture_change())

        self.build_ui()
        self.refresh_list()

    def build_ui(self) -> None:
        main = ttk.Frame(self.root, padding=10)
        main.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main.columnconfigure(1, weight=1)
        main.rowconfigure(0, weight=1)

        split = ttk.Panedwindow(main, orient=tk.HORIZONTAL)
        split.grid(row=0, column=0, columnspan=2, sticky="nsew")

        list_frame = ttk.Frame(split)
        list_frame.rowconfigure(0, weight=1)
        list_frame.columnconfigure(0, weight=1)

        self.listbox = tk.Listbox(
            list_frame,
            height=18,
            width=60,
            exportselection=False,
        )
        self.listbox.grid(row=0, column=0, sticky="nsew")
        self.listbox.bind("<<ListboxSelect>>", self.on_select)
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.listbox.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.listbox.configure(yscrollcommand=scrollbar.set)

        form = ttk.Frame(split)
        for idx in range(15):
            form.rowconfigure(idx, weight=0)
        form.columnconfigure(1, weight=1)

        split.add(list_frame, weight=1)
        split.add(form, weight=3)

        self.add_form_row(
            form,
            0,
            f"Texture ({TANK_IMG_SIZE}x{TANK_IMG_SIZE})",
            self.texture_var,
            browse=True,
        )
        self.add_texture_preview(form, row=1)
        self.add_form_row(form, 2, "Tank label", self.tank_label_var)
        self.add_form_row(form, 3, "Speed (px/frame)", self.speed_var)
        self.add_form_row(form, 4, "Cooldown", self.cooldown_var)
        self.add_form_row(form, 5, "Tank hit point", self.hit_point_var)
        self.add_form_row(form, 6, "Bound min X", self.bound_min_x_var)
        self.add_form_row(form, 7, "Bound min Y", self.bound_min_y_var)
        self.add_form_row(form, 8, "Bound max X", self.bound_max_x_var)
        self.add_form_row(form, 9, "Bound max Y", self.bound_max_y_var)

        ttk.Label(form, text="Shell size").grid(row=10, column=0, sticky="w", pady=4)
        shell_size = ttk.Combobox(form, textvariable=self.shell_size_var, values=sorted(SHELL_SIZES), state="readonly")
        shell_size.grid(row=10, column=1, sticky="ew", pady=4)

        self.add_form_row(form, 11, "Shell speed", self.shell_speed_var)

        ttk.Label(form, text="Shell color").grid(row=12, column=0, sticky="w", pady=4)
        shell_color = ttk.Combobox(form, textvariable=self.shell_color_var, values=SHELL_COLORS, state="readonly")
        shell_color.grid(row=12, column=1, sticky="ew", pady=4)

        button_row = ttk.Frame(form)
        button_row.grid(row=13, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        button_row.columnconfigure(0, weight=1)
        button_row.columnconfigure(1, weight=1)
        button_row.columnconfigure(2, weight=1)

        ttk.Button(button_row, text="Add", command=self.add_entry).grid(row=0, column=0, sticky="ew", padx=2)
        ttk.Button(button_row, text="Update", command=self.update_entry).grid(row=0, column=1, sticky="ew", padx=2)
        ttk.Button(button_row, text="Remove", command=self.remove_entry).grid(row=0, column=2, sticky="ew", padx=2)

        info = ttk.Label(
            form,
            text=f"TANK_DATA_ROOT: {TANK_DATA_ROOT.as_posix()}",
            foreground="#666",
        )
        info.grid(row=14, column=0, columnspan=2, sticky="w", pady=(12, 0))

    def add_form_row(
        self,
        parent: ttk.Frame,
        row: int,
        label: str,
        variable: tk.StringVar,
        browse: bool = False,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=4)
        entry = ttk.Entry(parent, textvariable=variable)
        entry.grid(row=row, column=1, sticky="ew", pady=4)
        if browse:
            ttk.Button(parent, text="Browse", command=self.browse_texture).grid(row=row, column=2, padx=(6, 0))

    def add_texture_preview(self, parent: ttk.Frame, row: int) -> None:
        ttk.Label(parent, text="Texture preview").grid(row=row, column=0, sticky="nw", pady=4)
        preview_frame = ttk.Frame(parent)
        preview_frame.grid(row=row, column=1, sticky="w", pady=4)
        self.texture_preview = ttk.Label(preview_frame)
        self.texture_preview.grid(row=0, column=0, sticky="w")
        self.texture_path_label = ttk.Label(preview_frame, text="", foreground="#666")
        self.texture_path_label.grid(row=1, column=0, sticky="w", pady=(4, 0))

    def browse_texture(self) -> None:
        ensure_data_root()
        path = filedialog.askopenfilename(
            title=f"Select texture ({TANK_IMG_SIZE}x{TANK_IMG_SIZE})",
            initialdir=str(TANK_DATA_ROOT),
            filetypes=[("Image files", "*.png;*.jpg;*.jpeg;*.gif;*.webp"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            relative_path = normalize_texture_path(path)
        except ValueError as exc:
            messagebox.showerror("Invalid texture path", str(exc))
            return
        self.texture_var.set(relative_path)

    def on_texture_change(self) -> None:
        relative_path = self.texture_var.get().strip()
        if not relative_path:
            self.clear_texture_preview(clear_label=True)
            return
        if self.texture_path_label is not None:
            self.texture_path_label.config(text=relative_path)
        self.load_texture_preview(relative_path)

    def clear_texture_preview(self, clear_label: bool = False) -> None:
        self.texture_image = None
        if self.texture_preview is not None:
            self.texture_preview.config(image="")
        if clear_label and self.texture_path_label is not None:
            self.texture_path_label.config(text="")
        self.bound_min_x_var.set("")
        self.bound_min_y_var.set("")
        self.bound_max_x_var.set("")
        self.bound_max_y_var.set("")

    def load_texture_preview(self, relative_path: str) -> None:
        texture_path = (TANK_DATA_ROOT / relative_path).resolve()
        if not texture_path.exists():
            self.clear_texture_preview()
            return
        try:
            image = tk.PhotoImage(file=str(texture_path))
        except tk.TclError:
            self.clear_texture_preview()
            return
        self.texture_image = image
        if self.texture_preview is not None:
            preview = image
            max_dim = max(image.width(), image.height())
            if max_dim > 96:
                scale = max(1, max_dim // 96)
                preview = image.subsample(scale, scale)
            self.texture_preview.config(image=preview)
            self.texture_preview.image = preview
        self.update_bounds_from_image(image)

    def update_bounds_from_image(self, image: tk.PhotoImage) -> None:
        width = image.width()
        height = image.height()
        if width == 0 or height == 0:
            return
        background = image.get(0, 0)
        min_x = width
        min_y = height
        max_x = -1
        max_y = -1
        for y in range(height):
            for x in range(width):
                color = image.get(x, y)
                if not color or color == background:
                    continue
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
        if max_x >= min_x and max_y >= min_y:
            self.bound_min_x_var.set(str(min_x))
            self.bound_min_y_var.set(str(min_y))
            self.bound_max_x_var.set(str(max_x))
            self.bound_max_y_var.set(str(max_y))

    def refresh_list(self) -> None:
        self.listbox.delete(0, tk.END)
        for index, tank in enumerate(self.data):
            self.listbox.insert(tk.END, format_tank_line(index, tank))

    def on_select(self, _event: tk.Event) -> None:
        selection = self.listbox.curselection()
        if not selection:
            return
        index = selection[0]
        tank = self.data[index]
        self.tank_label_var.set(tank.get("tank_label", ""))
        self.texture_var.set(tank.get("texture", ""))
        self.speed_var.set(str(tank.get("speed", "")))
        self.cooldown_var.set(str(tank.get("cooldown", "")))
        self.hit_point_var.set(str(tank.get("tank_hit_point", "")))
        bound_min = tank.get("bound_min", {})
        bound_max = tank.get("bound_max", {})
        self.bound_min_x_var.set(str(bound_min.get("x", "")))
        self.bound_min_y_var.set(str(bound_min.get("y", "")))
        self.bound_max_x_var.set(str(bound_max.get("x", "")))
        self.bound_max_y_var.set(str(bound_max.get("y", "")))
        self.shell_size_var.set(str(tank.get("shell_size", "1")))
        self.shell_speed_var.set(str(tank.get("shell_speed", "")))
        self.shell_color_var.set(str(tank.get("shell_color", SHELL_COLORS[0])))

    def parse_int(self, value: str, field_name: str) -> int:
        try:
            number = int(value)
        except ValueError as exc:
            raise ValueError(f"{field_name} must be an integer.") from exc
        return validate_positive_int(field_name, number)

    def build_tank_from_form(self) -> dict:
        tank_label = self.tank_label_var.get().strip()
        texture = normalize_texture_path(self.texture_var.get().strip())
        speed = self.parse_int(self.speed_var.get().strip(), "speed")
        cooldown = self.parse_int(self.cooldown_var.get().strip(), "cooldown")
        cooldown = validate_positive_int("cooldown", cooldown, minimum=0)
        hit_point = self.parse_int(self.hit_point_var.get().strip(), "tank hit point")
        hit_point = validate_positive_int("tank hit point", hit_point, minimum=1)
        bound_min_x = self.parse_int(self.bound_min_x_var.get().strip(), "bound min x")
        bound_min_y = self.parse_int(self.bound_min_y_var.get().strip(), "bound min y")
        bound_max_x = self.parse_int(self.bound_max_x_var.get().strip(), "bound max x")
        bound_max_y = self.parse_int(self.bound_max_y_var.get().strip(), "bound max y")
        shell_size = validate_shell_size(self.parse_int(self.shell_size_var.get().strip(), "shell size"))
        shell_speed = self.parse_int(self.shell_speed_var.get().strip(), "shell speed")
        shell_color = validate_shell_color(self.shell_color_var.get().strip())
        return {
            "tank_label": tank_label,
            "texture": texture,
            "speed": speed,
            "cooldown": cooldown,
            "tank_hit_point": hit_point,
            "bound_min": {"x": bound_min_x, "y": bound_min_y},
            "bound_max": {"x": bound_max_x, "y": bound_max_y},
            "shell_size": shell_size,
            "shell_speed": shell_speed,
            "shell_color": shell_color,
        }

    def add_entry(self) -> None:
        try:
            tank = self.build_tank_from_form()
            validate_unique_label(tank.get("tank_label", ""), self.data)
        except ValueError as exc:
            messagebox.showerror("Invalid tank data", str(exc))
            return
        self.data.append(tank)
        save_data(self.data)
        self.refresh_list()
        self.listbox.selection_clear(0, tk.END)
        self.listbox.selection_set(tk.END)
        self.listbox.see(tk.END)

    def update_entry(self) -> None:
        selection = self.listbox.curselection()
        if not selection:
            messagebox.showerror("No selection", "Select a tank to update.")
            return
        try:
            tank = self.build_tank_from_form()
            validate_unique_label(tank.get("tank_label", ""), self.data, ignore_index=selection[0])
        except ValueError as exc:
            messagebox.showerror("Invalid tank data", str(exc))
            return
        index = selection[0]
        self.data[index] = tank
        save_data(self.data)
        self.refresh_list()
        self.listbox.selection_set(index)

    def remove_entry(self) -> None:
        selection = self.listbox.curselection()
        if not selection:
            messagebox.showerror("No selection", "Select a tank to remove.")
            return
        index = selection[0]
        self.data.pop(index)
        save_data(self.data)
        self.refresh_list()


def run_gui() -> None:
    root = tk.Tk()
    TankEditorGUI(root)
    root.mainloop()


def add_tank(args: argparse.Namespace) -> None:
    data = load_data()
    tank_label = (args.tank_label or "").strip()
    validate_unique_label(tank_label, data)
    texture = normalize_texture_path(args.texture)
    speed = validate_positive_int("speed", args.speed)
    cooldown = validate_positive_int("cooldown", args.cooldown, minimum=0)
    hit_point = validate_positive_int("tank_hit_point", args.tank_hit_point, minimum=1)
    bound_min_x = validate_positive_int("bound_min_x", args.bound_min_x)
    bound_min_y = validate_positive_int("bound_min_y", args.bound_min_y)
    bound_max_x = validate_positive_int("bound_max_x", args.bound_max_x)
    bound_max_y = validate_positive_int("bound_max_y", args.bound_max_y)
    shell_size = validate_shell_size(args.shell_size)
    shell_speed = validate_positive_int("shell_speed", args.shell_speed)
    shell_color = validate_shell_color(args.shell_color)

    tank = {
        "tank_label": tank_label,
        "texture": texture,
        "speed": speed,
        "cooldown": cooldown,
        "tank_hit_point": hit_point,
        "bound_min": {"x": bound_min_x, "y": bound_min_y},
        "bound_max": {"x": bound_max_x, "y": bound_max_y},
        "shell_size": shell_size,
        "shell_speed": shell_speed,
        "shell_color": shell_color,
    }
    data.append(tank)
    save_data(data)
    list_tanks(data)


def remove_tank(args: argparse.Namespace) -> None:
    data = load_data()
    if args.index < 0 or args.index >= len(data):
        raise ValueError("Index out of range.")
    data.pop(args.index)
    save_data(data)
    list_tanks(data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tank data editor")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list", help="List all tanks")
    subparsers.add_parser("gui", help="Launch the GUI editor")

    add_parser = subparsers.add_parser("add", help="Add a tank")
    add_parser.add_argument("--tank-label", default="", help="Unique tank label (optional)")
    add_parser.add_argument("--texture", required=True, help="Path under TANK_DATA_ROOT")
    add_parser.add_argument("--speed", required=True, type=int, help="Pixels per frame")
    add_parser.add_argument("--cooldown", default=0, type=int, help="Tank cooldown")
    add_parser.add_argument("--tank-hit-point", default=1, type=int, help="Tank hit points")
    add_parser.add_argument("--bound-min-x", required=True, type=int, help="Tank bound min X")
    add_parser.add_argument("--bound-min-y", required=True, type=int, help="Tank bound min Y")
    add_parser.add_argument("--bound-max-x", required=True, type=int, help="Tank bound max X")
    add_parser.add_argument("--bound-max-y", required=True, type=int, help="Tank bound max Y")
    add_parser.add_argument("--shell-size", required=True, type=int, help="Shell size (1,2,3)")
    add_parser.add_argument("--shell-speed", required=True, type=int, help="Shell speed")
    add_parser.add_argument("--shell-color", required=True, help="Shell color")

    remove_parser = subparsers.add_parser("remove", help="Remove tank by index")
    remove_parser.add_argument("index", type=int, help="Tank index")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command in (None, "gui"):
            run_gui()
            return 0
        if args.command == "list":
            list_tanks(load_data())
            return 0
        if args.command == "add":
            add_tank(args)
            return 0
        if args.command == "remove":
            remove_tank(args)
            return 0
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
