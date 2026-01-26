#!/usr/bin/env python3
"""
Tank Arena Map Editor
A Python-based map editor for creating and editing game maps.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import json
import os
from profiler import TimeProfiler, profile_time
from tile_definitions import (
    TILE_TYPES, TILE_SIZE, MAP_SIZES, CANVAS_SCALE,
    is_accessible, is_destructible, blocks_bullet,
    get_tile_color, get_tile_name, validate_tile_id
)


class MapEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("Tank Arena Map Editor")
        self.root.geometry("1200x800")
        
        # Map data (map_size is pixels, tile_count is tiles)
        self.map_size = 512
        self.tile_count = self.map_size // TILE_SIZE
        self.tiles = []
        self.selected_tile = 0
        self.selection_start = None
        self.selection_end = None
        self.is_selecting = False
        
        # Cached map image for fast rendering
        self.map_image = None
        self.map_image_id = None
        self.map_image_pil = None
        self.map_image_zoomed = None
        self.map_image_zoom = 1.0
        self.image_cache_dirty = True
        self.editing_area_size = 100  # Size of editing area in tiles
        self.current_editing_center = None  # Center of current editing area
        self.edited_region = None  # Track edited region: (min_row, max_row, min_col, max_col)
        self.dirty_tile_list = set()  # Track dirty tiles (row, col)
        self.zoom = 1.0
        self.zoom_min = 0.25
        self.zoom_max = 4.0
        self.spawn_limits = {
            6: 2,  # Player Tank Spawn
            5: 4,  # AI Tank Spawn
            7: 2,  # Player HQ
        }
        self.tile_textures = {}
        self.tile_textures_tk = {}
        self.tile_textures_zoomed = {}
        self.tile_palette_images = {}
        self.undo_stack = []
        self.redo_stack = []
        self.current_action = None
        
        # Statistics panel
        self.stats_panel = None
        self.stats_text = None
        self.stats_update_interval = 1000  # Update every second
        
        # Create UI
        self.create_menu()
        self.create_toolbar()
        self.create_canvas()
        self.load_tile_textures()
        self.create_palette()
        self.create_statistics_panel()
        
        # Initialize empty map
        self.new_map(512)
        self.edited_region = None  # Initialize edited region tracking
        
        # Start statistics update timer
        self.update_statistics_display()
        # Start redraw loop
        self.schedule_redraw_loop()

    def schedule_redraw_loop(self):
        """Periodically redraw when updates are pending."""
        if self.needs_redraw or self.dirty_tile_list:
            self.draw_map()
        self.root.after(50, self.schedule_redraw_loop)
        
    def create_menu(self):
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)
        
        # File menu
        file_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=file_menu)
        file_menu.add_command(label="New Map", command=self.new_map_dialog, accelerator="Ctrl+N")
        file_menu.add_separator()
        file_menu.add_command(label="Open", command=self.load_map, accelerator="Ctrl+O")
        file_menu.add_command(label="Save", command=self.save_map, accelerator="Ctrl+S")
        file_menu.add_command(label="Save As", command=self.save_map_as, accelerator="Ctrl+Shift+S")
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)
        
        # Edit menu
        edit_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Edit", menu=edit_menu)
        edit_menu.add_command(label="Undo", command=self.undo, accelerator="Ctrl+Z")
        edit_menu.add_command(label="Redo", command=self.redo, accelerator="Ctrl+Y")
        edit_menu.add_separator()
        edit_menu.add_command(label="Clear Map", command=self.clear_map)
        edit_menu.add_command(label="Fill Selected Area", command=self.fill_selection, accelerator="F")
        edit_menu.add_separator()
        edit_menu.add_command(label="Show Profile Stats", command=self.show_profile_stats)
        edit_menu.add_command(label="Clear Profile Data", command=self.clear_profile_data)
        
        # View menu
        view_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="View", menu=view_menu)
        self.stats_visible = tk.BooleanVar(value=False)
        view_menu.add_checkbutton(label="Show Statistics Panel", 
                                 variable=self.stats_visible,
                                 command=self.toggle_statistics_panel)
        
        # Bind keyboard shortcuts
        self.root.bind('<Control-n>', lambda e: self.new_map_dialog())
        self.root.bind('<Control-o>', lambda e: self.load_map())
        self.root.bind('<Control-s>', lambda e: self.save_map())
        self.root.bind('<Control-S>', lambda e: self.save_map_as())
        self.root.bind('<KeyPress-f>', lambda e: self.fill_selection())
        self.root.bind('<KeyPress-F>', lambda e: self.fill_selection())
        self.root.bind('<Control-z>', lambda e: self.undo())
        self.root.bind('<Control-Z>', lambda e: self.undo())
        self.root.bind('<Control-y>', lambda e: self.redo())
        self.root.bind('<Control-Y>', lambda e: self.redo())
        
    def create_toolbar(self):
        toolbar = ttk.Frame(self.root)
        toolbar.pack(side=tk.TOP, fill=tk.X, padx=5, pady=5)
        
        # Map size selector
        ttk.Label(toolbar, text="Map Size:").pack(side=tk.LEFT, padx=5)
        self.size_var = tk.StringVar(value="512")
        size_combo = ttk.Combobox(toolbar, textvariable=self.size_var, 
                                 values=["512", "1024", "2048"], 
                                 state="readonly", width=10)
        size_combo.pack(side=tk.LEFT, padx=5)
        size_combo.bind("<<ComboboxSelected>>", self.on_size_change)
        
        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=10)
        
        # Selection info
        self.selection_label = ttk.Label(toolbar, text="Selection: None")
        self.selection_label.pack(side=tk.LEFT, padx=5)
        
        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=10)
        
        # Fill button
        fill_btn = ttk.Button(toolbar, text="Fill Selected Area (F)", command=self.fill_selection)
        fill_btn.pack(side=tk.LEFT, padx=5)

        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=10)

        # Zoom indicator
        self.zoom_label = ttk.Label(toolbar, text="Zoom: 100%")
        self.zoom_label.pack(side=tk.LEFT, padx=5)
        reset_zoom_btn = ttk.Button(toolbar, text="Reset", command=self.reset_zoom)
        reset_zoom_btn.pack(side=tk.LEFT, padx=5)
        
    def create_canvas(self):
        canvas_frame = ttk.Frame(self.root)
        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Scrollbars
        v_scrollbar = ttk.Scrollbar(canvas_frame, orient=tk.VERTICAL)
        v_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        h_scrollbar = ttk.Scrollbar(canvas_frame, orient=tk.HORIZONTAL)
        h_scrollbar.pack(side=tk.BOTTOM, fill=tk.X)
        
        # Canvas
        self.canvas = tk.Canvas(canvas_frame, 
                                 bg="#2a2a2a",
                                 yscrollcommand=v_scrollbar.set,
                                 xscrollcommand=h_scrollbar.set)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        v_scrollbar.config(command=self.canvas.yview)
        h_scrollbar.config(command=self.canvas.xview)
        
        # Canvas events
        self.canvas.bind("<Button-1>", self.on_canvas_click)
        self.canvas.bind("<B1-Motion>", self.on_canvas_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_canvas_release)
        self.canvas.bind("<Motion>", self.on_canvas_motion)
        
        # Track if we need to redraw on scroll
        self.needs_redraw = False
        
    def create_palette(self):
        palette_frame = ttk.LabelFrame(self.root, text="Tile Palette")
        palette_frame.pack(side=tk.RIGHT, fill=tk.Y, padx=5, pady=5)
        
        # Tile buttons
        self.tile_buttons = []
        for tile_id, tile_info in TILE_TYPES.items():
            frame = ttk.Frame(palette_frame)
            frame.pack(fill=tk.X, padx=5, pady=2)
            
            # Color preview
            color_canvas = tk.Canvas(frame, width=30, height=30, bg=tile_info["color"],
                                    relief=tk.RAISED, borderwidth=2)
            color_canvas.pack(side=tk.LEFT, padx=2)
            if tile_id in self.tile_palette_images:
                color_canvas.create_image(0, 0, anchor=tk.NW, image=self.tile_palette_images[tile_id])
            
            # Label
            label = ttk.Label(frame, text=f"{tile_id}: {tile_info['name']}", width=20)
            label.pack(side=tk.LEFT, padx=5)
            
            # Properties
            props = []
            if tile_info["accessible"]:
                props.append("A")
            if tile_info["destructible"]:
                props.append("D")
            if tile_info["blocks_bullet"]:
                props.append("B")
            if tile_id == 3:  # Grass
                props.append("I")  # Invisible
            
            props_label = ttk.Label(frame, text="(" + ",".join(props) + ")", 
                                   font=("Arial", 8), foreground="gray")
            props_label.pack(side=tk.LEFT, padx=2)
            
            # Bind click to select tile
            def make_select_handler(tid):
                return lambda e: self.select_tile(tid)
            
            color_canvas.bind("<Button-1>", make_select_handler(tile_id))
            label.bind("<Button-1>", make_select_handler(tile_id))
            
            self.tile_buttons.append({
                "id": tile_id,
                "canvas": color_canvas,
                "label": label
            })
        
        # Selected tile indicator
        ttk.Separator(palette_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=10)
        self.selected_label = ttk.Label(palette_frame, text="Selected: Soil (0)", 
                                        font=("Arial", 10, "bold"))
        self.selected_label.pack(pady=5)
        
        # Legend
        legend_frame = ttk.LabelFrame(palette_frame, text="Legend")
        legend_frame.pack(fill=tk.X, padx=5, pady=5)
        ttk.Label(legend_frame, text="A = Accessible", font=("Arial", 8)).pack(anchor=tk.W)
        ttk.Label(legend_frame, text="D = Destructible", font=("Arial", 8)).pack(anchor=tk.W)
        ttk.Label(legend_frame, text="B = Blocks Bullet", font=("Arial", 8)).pack(anchor=tk.W)
        ttk.Label(legend_frame, text="I = Invisible (Grass)", font=("Arial", 8)).pack(anchor=tk.W)

    def load_tile_textures(self):
        """Load tile textures from tiles folder if available."""
        try:
            from PIL import Image, ImageTk
        except ImportError:
            return
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        tiles_dir = os.path.join(repo_root, "maps", "tiles")
        if not os.path.isdir(tiles_dir):
            return
        self.tile_textures.clear()
        self.tile_textures_tk.clear()
        self.tile_textures_zoomed.clear()
        self.tile_palette_images.clear()
        for tile_id in TILE_TYPES.keys():
            filename = f"{tile_id}.png"
            path = os.path.join(tiles_dir, filename)
            if not os.path.isfile(path):
                continue
            try:
                img = Image.open(path).convert("RGBA")
            except Exception:
                continue
            if img.size != (TILE_SIZE, TILE_SIZE):
                img = img.resize((TILE_SIZE, TILE_SIZE), resample=Image.NEAREST)
            self.tile_textures[tile_id] = img
            self.tile_textures_tk[tile_id] = ImageTk.PhotoImage(img)
            palette_img = img.resize((30, 30), resample=Image.NEAREST)
            self.tile_palette_images[tile_id] = ImageTk.PhotoImage(palette_img)
    
    def create_statistics_panel(self):
        """Create the statistics panel for displaying timer costs"""
        # Statistics panel frame (initially hidden)
        self.stats_panel = ttk.LabelFrame(self.root, text="Performance Statistics")
        # Don't pack it initially - will be shown/hidden via toggle
        
        # Create scrollable text widget
        stats_frame = ttk.Frame(self.stats_panel)
        stats_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Scrollbar
        stats_scrollbar = ttk.Scrollbar(stats_frame)
        stats_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Text widget
        self.stats_text = tk.Text(stats_frame, 
                                  width=30, 
                                  height=20,
                                  font=("Courier", 9),
                                  yscrollcommand=stats_scrollbar.set,
                                  wrap=tk.WORD,
                                  state=tk.DISABLED)
        self.stats_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        stats_scrollbar.config(command=self.stats_text.yview)
        
        # Refresh button
        refresh_btn = ttk.Button(self.stats_panel, text="Refresh", command=self.update_statistics_display)
        refresh_btn.pack(pady=5)
    
    def toggle_statistics_panel(self):
        """Toggle visibility of statistics panel"""
        if self.stats_visible.get():
            # Show panel - pack it on the left side
            self.stats_panel.pack(side=tk.LEFT, fill=tk.Y, padx=5, pady=5)
            self.update_statistics_display()
        else:
            # Hide panel
            self.stats_panel.pack_forget()
    
    def update_statistics_display(self):
        """Update the statistics display with current profiling data"""
        if not self.stats_panel or not self.stats_text:
            return
        
        # Only update if panel is visible
        if not self.stats_visible.get():
            return
        
        stats = TimeProfiler.get_stats()
        
        # Enable text widget for editing
        self.stats_text.config(state=tk.NORMAL)
        self.stats_text.delete("1.0", tk.END)
        
        if not stats:
            self.stats_text.insert("1.0", "No profiling data collected yet.\n\n"
                                          "Profiling data will appear here as you use the editor.")
        else:
            # Group by tag if available
            by_tag = {}
            no_tag = []
            
            for name, stat_data in sorted(stats.items()):
                tag = stat_data.get("tag")
                if tag:
                    if tag not in by_tag:
                        by_tag[tag] = []
                    by_tag[tag].append((name, stat_data))
                else:
                    no_tag.append((name, stat_data))
            
            # Display by tag
            if by_tag:
                self.stats_text.insert(tk.END, "PROFILING STATISTICS\n")
                self.stats_text.insert(tk.END, "=" * 50 + "\n\n")
                
                for tag in sorted(by_tag.keys()):
                    self.stats_text.insert(tk.END, f"Tag: {tag}\n")
                    self.stats_text.insert(tk.END, "-" * 50 + "\n")
                    
                    for name, stat_data in sorted(by_tag[tag]):
                        self.stats_text.insert(tk.END, f"\n{name}:\n")
                        self.stats_text.insert(tk.END, f"  Calls:   {stat_data['count']}\n")
                        self.stats_text.insert(tk.END, f"  Total:   {stat_data['total']*1000:.2f}ms\n")
                        self.stats_text.insert(tk.END, f"  Avg:     {stat_data['avg']*1000:.2f}ms\n")
                        self.stats_text.insert(tk.END, f"  Min:     {stat_data['min']*1000:.2f}ms\n")
                        self.stats_text.insert(tk.END, f"  Max:     {stat_data['max']*1000:.2f}ms\n")
                    
                    self.stats_text.insert(tk.END, "\n")
            
            # Display untagged
            if no_tag:
                if by_tag:
                    self.stats_text.insert(tk.END, "\n" + "=" * 50 + "\n")
                    self.stats_text.insert(tk.END, "Untagged:\n")
                    self.stats_text.insert(tk.END, "-" * 50 + "\n")
                
                for name, stat_data in sorted(no_tag):
                    self.stats_text.insert(tk.END, f"\n{name}:\n")
                    self.stats_text.insert(tk.END, f"  Calls:   {stat_data['count']}\n")
                    self.stats_text.insert(tk.END, f"  Total:   {stat_data['total']*1000:.2f}ms\n")
                    self.stats_text.insert(tk.END, f"  Avg:     {stat_data['avg']*1000:.2f}ms\n")
                    self.stats_text.insert(tk.END, f"  Min:     {stat_data['min']*1000:.2f}ms\n")
                    self.stats_text.insert(tk.END, f"  Max:     {stat_data['max']*1000:.2f}ms\n")
        
        self.stats_text.config(state=tk.DISABLED)
        
        # Schedule next update
        self.root.after(self.stats_update_interval, self.update_statistics_display)
        
    def select_tile(self, tile_id):
        self.selected_tile = tile_id
        tile_info = TILE_TYPES[tile_id]
        self.selected_label.config(text=f"Selected: {tile_info['name']} ({tile_id})")
        
        # Update button highlights
        for btn in self.tile_buttons:
            if btn["id"] == tile_id:
                btn["canvas"].config(relief=tk.SUNKEN, borderwidth=3)
            else:
                btn["canvas"].config(relief=tk.RAISED, borderwidth=2)
    
    def new_map_dialog(self):
        dialog = tk.Toplevel(self.root)
        dialog.title("New Map")
        dialog.geometry("300x150")
        dialog.transient(self.root)
        dialog.grab_set()
        
        ttk.Label(dialog, text="Select Map Size:").pack(pady=10)
        
        size_var = tk.StringVar(value="512")
        size_combo = ttk.Combobox(dialog, textvariable=size_var, 
                                  values=["512", "1024", "2048"], 
                                  state="readonly", width=15)
        size_combo.pack(pady=10)
        
        def create():
            size = int(size_var.get())
            self.new_map(size)
            dialog.destroy()
        
        ttk.Button(dialog, text="Create", command=create).pack(pady=10)
        ttk.Button(dialog, text="Cancel", command=dialog.destroy).pack()
    
    def new_map(self, size):
        """Create a new map with specified size"""
        # Show progress for large maps
        if size >= 2048:
            self.root.title("Tank Arena Map Editor - Creating map...")
            self.root.update()
        
        self.map_size = size  # pixels
        if self.map_size % TILE_SIZE != 0:
            raise ValueError("map_size must be divisible by TILE_SIZE")
        self.tile_count = self.map_size // TILE_SIZE
        self.tiles = [[0 for _ in range(self.tile_count)] for _ in range(self.tile_count)]
        self.size_var.set(str(size))
        
        # Reset scroll position
        self.canvas.xview_moveto(0)
        self.canvas.yview_moveto(0)
        
        # Reset editing center
        self.current_editing_center = None
        
        # Force canvas to update size before drawing
        self.root.update_idletasks()
        
        # Mark cache as dirty and regenerate
        self.image_cache_dirty = True
        self.map_image = None
        self.map_image_id = None
        self.edited_region = None  # Reset edited region for full regeneration
        
        self.update_map_image_cache()
        self.draw_map()
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.current_action = None
        self.current_file = None
        self.root.title("Tank Arena Map Editor")
    
    def clear_map(self):
        if messagebox.askyesno("Clear Map", "Are you sure you want to clear the entire map?"):
            self.begin_action()
            for row in range(self.tile_count):
                for col in range(self.tile_count):
                    if self.tiles[row][col] != 0:
                        self.record_change(row, col, self.tiles[row][col])
                        self.tiles[row][col] = 0
                        self.dirty_tile_list.add((row, col))
            self.end_action()
            self.edited_region = None  # Reset edited region for full regeneration
            self.image_cache_dirty = True
            self.needs_redraw = True

    def count_tiles(self, tile_id):
        return sum(row.count(tile_id) for row in self.tiles)

    def can_place_tile(self, row, col, tile_id):
        limit = self.spawn_limits.get(tile_id)
        if limit is None:
            return True
        current = self.count_tiles(tile_id)
        existing = self.tiles[row][col]
        if existing == tile_id:
            return True
        return current < limit
    
    def generate_map_image(self, region=None):
        """
        Generate a cached image of the entire map or update a specific region
        
        Args:
            region: Optional tuple (min_row, max_row, min_col, max_col) to update only a region.
                   If None, generates the entire map.
        """
        with profile_time("generate_map_image", verbose=True, tag="cache"):
            if self.map_size == 0:
                return None

            if self.tile_textures:
                textured = self.generate_textured_map_image()
                if textured is not None:
                    return textured
            
            # Create PhotoImage for the map (map_size is in pixels)
            img_width = self.map_size
            img_height = self.map_size
            
            # If updating a region and image exists, use existing image, otherwise create new
            if region is not None and self.map_image is not None:
                # Check if existing image supports put() (native PhotoImage does, PIL ImageTk.PhotoImage doesn't)
                if hasattr(self.map_image, 'put'):
                    img = self.map_image
                else:
                    # PIL image doesn't support put(), need to create new native PhotoImage for full regeneration
                    with profile_time("generate_map_image.create_image", verbose=False):
                        img = tk.PhotoImage(width=img_width, height=img_height)
                    # Treat as full image generation since PIL image can't be updated in place
                    region = None
                min_row, max_row, min_col, max_col = region if region else (0, self.tile_count - 1, 0, self.tile_count - 1)
            else:
                with profile_time("generate_map_image.create_image", verbose=False):
                    # Create placeholder image (will be replaced if using PIL optimization)
                    img = tk.PhotoImage(width=img_width, height=img_height)
                min_row, max_row, min_col, max_col = 0, self.tile_count - 1, 0, self.tile_count - 1
            
            # Build pixel data row by row for better performance
            # Process in chunks to show progress for large maps
            chunk_size = max(100, self.tile_count // 10)  # Process 10% at a time or 100 rows
            
            total_pixels = 0
            # Pre-cache tile colors
            tile_colors_cache = [TILE_TYPES[i]["color"] for i in range(len(TILE_TYPES))]
            num_rows = max_row - min_row + 1
            num_cols = max_col - min_col + 1
            tiles_data = self.tiles  # Cache reference
            
            # OPTIMIZATION: Check for uniform tiles early (before building strings)
            is_uniform = False
            uniform_tile_id = None
            if num_rows * num_cols > 1000000 and region is None:
                # Quick uniform check for large full images (sample corners + center)
                first_tile = tiles_data[min_row][min_col]
                center_row = (min_row + max_row) // 2
                center_col = (min_col + max_col) // 2
                is_uniform = (tiles_data[min_row][max_col] == first_tile and 
                            tiles_data[max_row][min_col] == first_tile and
                            tiles_data[max_row][max_col] == first_tile and
                            tiles_data[center_row][center_col] == first_tile)
                if is_uniform:
                    uniform_tile_id = first_tile
            
            with profile_time("generate_map_image.fill_pixels", verbose=False, tag="cache"):
                # OPTIMIZATION: For very large uniform images, use PIL fast path
                if is_uniform and num_rows * num_cols > 1000000 and region is None:
                    try:
                        from PIL import Image, ImageTk
                        # Ultra-fast path: single color for entire image
                        uniform_color_hex = tile_colors_cache[uniform_tile_id]
                        uniform_rgb = tuple(int(uniform_color_hex[i:i+2], 16) for i in (1, 3, 5))
                        # Create image with uniform color (instant - no pixel iteration needed)
                        pil_img = Image.new('RGB', (img_width, img_height), color=uniform_rgb)
                        self.map_image_pil = pil_img
                        self.map_image_zoomed = None
                        img = ImageTk.PhotoImage(pil_img)
                        total_pixels = num_rows * num_cols
                        # Early return - skip all string building
                        return img
                    except ImportError:
                        # PIL not available, fall through to standard path
                        is_uniform = False
                
                if not (is_uniform and num_rows * num_cols > 1000000):
                    # Standard path: build row strings or use PIL for non-uniform large images
                    with profile_time("generate_map_image.build_row_strings", verbose=False, tag="cache"):
                        row_strings = []
                        
                        if CANVAS_SCALE == 1:
                            row_strings_append = row_strings.append
                            for row_idx in range(min_row, max_row + 1):
                                row_data = tiles_data[row_idx]
                                row_str = "{" + " ".join(tile_colors_cache[row_data[col]] for col in range(min_col, max_col + 1)) + "}"
                                row_strings_append(row_str)
                                total_pixels += num_cols
                        else:
                            # For CANVAS_SCALE > 1
                            row_strings_extend = row_strings.extend
                            for row_idx in range(min_row, max_row + 1):
                                row_data = tiles_data[row_idx]
                                row_colors = []
                                row_colors_extend = row_colors.extend
                                for col in range(min_col, max_col + 1):
                                    color = tile_colors_cache[row_data[col]]
                                    row_colors_extend([color] * CANVAS_SCALE)
                                    total_pixels += CANVAS_SCALE
                                row_str = "{" + " ".join(row_colors) + "}"
                                row_strings_extend([row_str] * CANVAS_SCALE)
                
                # Apply rows using put() with region bounds if updating a region
                # Skip if we already created image using PIL uniform fast path
                if not (is_uniform and num_rows * num_cols > 1000000 and region is None):
                    with profile_time("generate_map_image.put_rows", verbose=False, tag="cache"):
                        try:
                            if region is not None and self.map_image is not None:
                                # Update only the specific region using 'to' parameter
                                # NOTE: For region updates, we must use native PhotoImage (not PIL)
                                # because PIL's ImageTk.PhotoImage doesn't support put() method
                                
                                # Check if self.map_image supports put() method (native PhotoImage does, PIL ImageTk.PhotoImage doesn't)
                                if not hasattr(self.map_image, 'put'):
                                    # PIL ImageTk.PhotoImage doesn't support put(), so we need to regenerate the full image
                                    # Fall through to full image generation below
                                    pass
                                else:
                                    # Native PhotoImage supports put(), so we can update just the region
                                    # Calculate pixel coordinates for the region
                                    x1 = min_col * CANVAS_SCALE
                                    y1 = min_row * CANVAS_SCALE
                                    x2 = (max_col + 1) * CANVAS_SCALE
                                    y2 = (max_row + 1) * CANVAS_SCALE
                                    
                                    # OPTIMIZATION: Use efficient string join (Python's join is already optimized)
                                    # Join all rows with spaces: "{row1} {row2} {row3} ..."
                                    data_string = " ".join(row_strings)
                                    # Update only the specified region on the existing native PhotoImage
                                    self.map_image.put(data_string, to=(x1, y1, x2, y2))
                                    # Return the existing image (not a new one)
                                    return self.map_image
                            
                            # Full image generation (either no region update, or PIL image that doesn't support put())
                            # If we reach here, we need to generate a full image (either no region, or PIL image detected)
                            # OPTIMIZATION: For very large images, try using PIL for faster rendering
                            # Check if we should use PIL optimization (for maps > 1M pixels)
                            if num_rows * num_cols > 1000000:
                                try:
                                    from PIL import Image, ImageTk
                                    # OPTIMIZATION: Fast path for uniform tiles using PIL
                                    first_tile = tiles_data[min_row][min_col]
                                    # Quick uniform check (sample corners)
                                    is_uniform = (tiles_data[min_row][max_col] == first_tile and 
                                                tiles_data[max_row][min_col] == first_tile and
                                                tiles_data[max_row][max_col] == first_tile)
                                    
                                    if is_uniform:
                                        # Ultra-fast path: single color for entire image
                                        uniform_color_hex = tile_colors_cache[first_tile]
                                        uniform_rgb = tuple(int(uniform_color_hex[i:i+2], 16) for i in (1, 3, 5))
                                        # Create image with uniform color (instant)
                                        pil_img = Image.new('RGB', (img_width, img_height), color=uniform_rgb)
                                    else:
                                        # Pre-cache hex to RGB conversions
                                        hex_to_rgb_cache = {}
                                        for color_hex in tile_colors_cache:
                                            hex_to_rgb_cache[color_hex] = tuple(int(color_hex[i:i+2], 16) for i in (1, 3, 5))
                                        
                                        # OPTIMIZATION: Use list comprehension for faster pixel data building
                                        pixel_data = [
                                            hex_to_rgb_cache[tile_colors_cache[tiles_data[row_idx][col_idx]]]
                                            for row_idx in range(min_row, max_row + 1)
                                            for col_idx in range(min_col, max_col + 1)
                                        ]
                                        
                                        # Create PIL image and set all pixels at once
                                        pil_img = Image.new('RGB', (img_width, img_height))
                                        pil_img.putdata(pixel_data)
                                    
                                    self.map_image_pil = pil_img
                                    self.map_image_zoomed = None
                                    # Convert to PhotoImage
                                    img = ImageTk.PhotoImage(pil_img)
                                except ImportError:
                                    # Fallback to standard PhotoImage.put() method
                                    data_string = " ".join(row_strings)
                                    # img is already a native PhotoImage from line 422, so put() will work
                                    img.put(data_string)
                            else:
                                # Standard method for smaller images
                                # img is already a native PhotoImage from line 422, so put() will work
                                data_string = " ".join(row_strings)
                                img.put(data_string)
                        except Exception as e:
                            # Fallback to individual pixel setting if batch format fails
                            import traceback
                            error_msg = f"Warning: Batch put() failed ({type(e).__name__}: {e}), falling back to individual pixels"
                            print(error_msg)
                            print(traceback.format_exc())
                            # Fallback: set pixels individually (slower but works)
                            # NOTE: For fallback, we must use native PhotoImage, not PIL
                            if region is not None and self.map_image is not None and hasattr(self.map_image, 'put'):
                                # Use existing native PhotoImage for region updates (only if it supports put())
                                fallback_img = self.map_image
                            else:
                                # Use the native PhotoImage we created earlier, or regenerate full image
                                if 'img' in locals() and hasattr(img, 'put'):
                                    fallback_img = img
                                else:
                                    # Need to create a new native PhotoImage for fallback
                                    fallback_img = tk.PhotoImage(width=img_width, height=img_height)
                            total_pixels = 0
                            for row in range(min_row * CANVAS_SCALE, (max_row + 1) * CANVAS_SCALE):
                                for col in range(min_col * CANVAS_SCALE, (max_col + 1) * CANVAS_SCALE):
                                    tile_row = row // CANVAS_SCALE
                                    tile_col = col // CANVAS_SCALE
                                    if 0 <= tile_row < self.tile_count and 0 <= tile_col < self.tile_count:
                                        tile_id = self.tiles[tile_row][tile_col]
                                        tile_info = TILE_TYPES[tile_id]
                                        color = tile_info["color"]
                                        fallback_img.put(color, (col, row))
                                        total_pixels += 1
                                if row % 100 == 0:
                                    self.root.update_idletasks()
                            # Return the fallback image (will be used as new full image if PIL was detected)
                            return fallback_img
            
            # Log detailed performance breakdown for large maps
            if self.map_size >= 1024:
                fill_stats = TimeProfiler.get_stats("generate_map_image.fill_pixels")
                build_rows_stats = TimeProfiler.get_stats("generate_map_image.build_row_strings")
                put_rows_stats = TimeProfiler.get_stats("generate_map_image.put_rows")
                
                if fill_stats:
                    pixels_per_ms = total_pixels / (fill_stats['total'] * 1000) if fill_stats['total'] > 0 else 0
                    print(f"\n[PROFILE] Image Generation Performance:")
                    print(f"[PROFILE]   Total pixels: {total_pixels:,}")
                    print(f"[PROFILE]   Total time: {fill_stats['total']*1000:.2f}ms")
                    print(f"[PROFILE]   Rate: {pixels_per_ms:.0f} pixels/ms")
                    
                    if build_rows_stats:
                        pct = (build_rows_stats['total'] / fill_stats['total'] * 100) if fill_stats['total'] > 0 else 0
                        print(f"[PROFILE]   Build row strings: {build_rows_stats['total']*1000:.2f}ms ({pct:.1f}%)")
                    if put_rows_stats:
                        pct = (put_rows_stats['total'] / fill_stats['total'] * 100) if fill_stats['total'] > 0 else 0
                        print(f"[PROFILE]   Put rows: {put_rows_stats['total']*1000:.2f}ms ({pct:.1f}%)")
                    print()
            
            return img

    def generate_textured_map_image(self):
        """Generate map image using tile textures."""
        try:
            from PIL import Image, ImageTk
        except ImportError:
            return None
        img_width = self.map_size
        img_height = self.map_size
        pil_img = Image.new("RGBA", (img_width, img_height))
        tile_cache = self.tile_textures
        for row in range(self.tile_count):
            y = row * TILE_SIZE
            row_data = self.tiles[row]
            for col in range(self.tile_count):
                tile_id = row_data[col]
                texture = tile_cache.get(tile_id)
                if texture is None:
                    color_hex = TILE_TYPES[tile_id]["color"]
                    color_rgb = tuple(int(color_hex[i:i+2], 16) for i in (1, 3, 5))
                    texture = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), color=color_rgb)
                pil_img.paste(texture, (col * TILE_SIZE, y))
        self.map_image_zoomed = None
        return ImageTk.PhotoImage(pil_img)
    
    def update_map_image_cache(self):
        """Update the cached map image (call after editing is complete)"""
        with profile_time("update_map_image_cache", verbose=True, tag="cache"):
            if self.image_cache_dirty:
                self.root.title("Tank Arena Map Editor - Updating cache...")
                self.root.update()
                
                with profile_time("update_map_image_cache.generate", verbose=False, tag="cache"):
                    used_region_update = False
                    # If we have dirty tiles and existing image, update only that region
                    if self.dirty_tile_list and self.map_image is not None:
                        used_region_update = True
                        rows = [pos[0] for pos in self.dirty_tile_list]
                        cols = [pos[1] for pos in self.dirty_tile_list]
                        min_row, max_row = min(rows), max(rows)
                        min_col, max_col = min(cols), max(cols)
                        # Expand region slightly to ensure clean boundaries
                        min_row = max(0, min_row - 1)
                        max_row = min(self.tile_count - 1, max_row + 1)
                        min_col = max(0, min_col - 1)
                        max_col = min(self.tile_count - 1, max_col + 1)
                        result_img = self.generate_map_image(region=(min_row, max_row, min_col, max_col))
                        # If a new image was created (e.g. PIL path), keep it
                        if result_img is not None and result_img is not self.map_image:
                            self.map_image = result_img
                    else:
                        # Full regeneration
                        self.map_image = self.generate_map_image()
                
                self.image_cache_dirty = False
                self.edited_region = None  # Clear edited region after update
                self.dirty_tile_list.clear()
                self.map_image_zoomed = None

                self.root.title("Tank Arena Map Editor")
                
                # Print detailed stats for large maps
                if self.map_size >= 1024:
                    cache_stats = TimeProfiler.get_stats("update_map_image_cache")
                    gen_stats = TimeProfiler.get_stats("generate_map_image")
                    if cache_stats and gen_stats:
                        print(f"[PROFILE] Cache update breakdown:")
                        print(f"  Total cache update: {cache_stats['total']*1000:.2f}ms")
                        print(f"  Image generation:   {gen_stats['total']*1000:.2f}ms")
                        print(f"  Overhead:            {(cache_stats['total'] - gen_stats['total'])*1000:.2f}ms")
    
    def draw_map(self):
        """Draw map using cached background image"""
        self.canvas.delete("all")
        
        # Update cached image only when redraw is requested
        if self.needs_redraw:
            if self.image_cache_dirty:
                self.update_map_image_cache()
            self.needs_redraw = False
        
        # Draw cached background image
        display_image = self.map_image
        if self.zoom != 1.0:
            display_image = self.get_zoomed_map_image()
        if display_image:
            if self.map_image_id:
                self.canvas.delete(self.map_image_id)
            self.map_image_id = self.canvas.create_image(0, 0, anchor=tk.NW, image=display_image, tags="background")
        else:
            pass
        
        # Get visible area and mouse position for editing area
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()
        
        if canvas_width <= 1 or canvas_height <= 1:
            canvas_width = self.map_size
            canvas_height = self.map_size
        
        # Get scroll position
        scroll_x = self.canvas.canvasx(0)
        scroll_y = self.canvas.canvasy(0)
        
        # Determine editing area center (use mouse position or viewport center)
        if self.current_editing_center:
            edit_col, edit_row = self.current_editing_center
        else:
            # Default to viewport center
            scale = CANVAS_SCALE * self.zoom
            edit_col = int((scroll_x + canvas_width / 2) / scale)
            edit_row = int((scroll_y + canvas_height / 2) / scale)
        
        # Draw dynamic tiles (dirty tiles not yet cached)
        if self.dirty_tile_list:
            scale = CANVAS_SCALE * self.zoom
            for row, col in self.dirty_tile_list:
                tile_id = self.tiles[row][col]
                x1 = col * scale
                y1 = row * scale
                x2 = x1 + scale
                y2 = y1 + scale
                texture = self.get_tile_texture_tk(tile_id)
                if texture is not None:
                    self.canvas.create_image(x1, y1, anchor=tk.NW, image=texture, tags="dynamic_tile")
                else:
                    color = get_tile_color(tile_id)
                    self.canvas.create_rectangle(
                        x1, y1, x2, y2,
                        fill=color,
                        outline="",
                        tags="dynamic_tile"
                    )
        
        # Update scroll region
        scroll_region = (0, 0, self.map_size * self.zoom, self.map_size * self.zoom)
        self.canvas.config(scrollregion=scroll_region)
        
        # Draw selection if exists
        if self.selection_start and self.selection_end:
            self.draw_selection()
        
        # Bind to scroll events
        self.canvas.bind("<Configure>", self.on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self.on_scroll)
        self.canvas.bind_all("<Button-4>", self.on_scroll)  # Linux
        self.canvas.bind_all("<Button-5>", self.on_scroll)  # Linux
    
    def draw_selection(self):
        if not self.selection_start or not self.selection_end:
            return
        
        # Remove old selection
        self.canvas.delete("selection")
        
        scale = CANVAS_SCALE * self.zoom
        x1 = min(self.selection_start[0], self.selection_end[0]) * scale
        y1 = min(self.selection_start[1], self.selection_end[1]) * scale
        x2 = (max(self.selection_start[0], self.selection_end[0]) + 1) * scale
        y2 = (max(self.selection_start[1], self.selection_end[1]) + 1) * scale
        
        self.canvas.create_rectangle(x1, y1, x2, y2, 
                                     outline="#FFFF00", width=2, 
                                     tags="selection", dash=(5, 5))
    
    def canvas_to_tile(self, x, y):
        canvas_x = self.canvas.canvasx(x)
        canvas_y = self.canvas.canvasy(y)
        scale = CANVAS_SCALE * self.zoom
        col = int(canvas_x / scale)
        row = int(canvas_y / scale)
        return (col, row)
    
    def on_canvas_click(self, event):
        col, row = self.canvas_to_tile(event.x, event.y)
        
        if 0 <= row < self.tile_count and 0 <= col < self.tile_count:
            # Update editing area center
            self.current_editing_center = (col, row)
            
            # Start selection or place tile
            if event.state & 0x1:  # Shift key held
                # Start area selection
                self.selection_start = (col, row)
                self.selection_end = (col, row)
                self.is_selecting = True
            else:
                # Place single tile
                if self.tiles[row][col] == self.selected_tile:
                    return
                if not self.can_place_tile(row, col, self.selected_tile):
                    messagebox.showwarning(
                        "Limit Reached",
                        f"{TILE_TYPES[self.selected_tile]['name']} limit reached."
                    )
                    return
                self.begin_action()
                self.record_change(row, col, self.tiles[row][col])
                self.tiles[row][col] = self.selected_tile
                # Store last click for verification
                self._last_click = (col, row, self.selected_tile)
                self.draw_tile(row, col)
                # Track edited region
                self.dirty_tile_list.add((row, col))
                # Defer cache update until mouse release
    
    def on_canvas_drag(self, event):
        col, row = self.canvas_to_tile(event.x, event.y)
        
        if 0 <= row < self.tile_count and 0 <= col < self.tile_count:
            # Update editing area center while dragging
            self.current_editing_center = (col, row)
            
            if self.is_selecting:
                self.selection_end = (col, row)
                self.draw_selection()
                
                # Update selection label
                width = abs(self.selection_end[0] - self.selection_start[0]) + 1
                height = abs(self.selection_end[1] - self.selection_start[1]) + 1
                self.selection_label.config(
                    text=f"Selection: {width}×{height} tiles"
                )
            else:
                # Place tiles while dragging
                if self.tiles[row][col] == self.selected_tile:
                    return
                if not self.can_place_tile(row, col, self.selected_tile):
                    return
                self.begin_action()
                self.record_change(row, col, self.tiles[row][col])
                self.tiles[row][col] = self.selected_tile
                self.draw_tile(row, col)
                # Track edited region
                self.dirty_tile_list.add((row, col))
                # Defer cache update until mouse release
    
    def on_canvas_release(self, event):
        self.is_selecting = False
        self.end_action()
        # Mark redraw needed after editing completes
        self.needs_redraw = True
    
    def on_canvas_motion(self, event):
        col, row = self.canvas_to_tile(event.x, event.y)
        if 0 <= row < self.tile_count and 0 <= col < self.tile_count:
            tile_id = self.tiles[row][col]
            tile_info = TILE_TYPES[tile_id]
            self.root.title(f"Tank Arena Map Editor - Tile: {tile_info['name']} ({col}, {row})")
            
            # Update editing area center to follow mouse
            if (self.current_editing_center is None or 
                abs(self.current_editing_center[0] - col) > self.editing_area_size // 4 or
                abs(self.current_editing_center[1] - row) > self.editing_area_size // 4):
                self.current_editing_center = (col, row)
                # Redraw to update editing area
                self.draw_map()
    
    def on_canvas_configure(self, event):
        """Redraw when canvas is resized"""
        self.draw_map()
    
    def on_scroll(self, event):
        """Scroll map or zoom with Ctrl + wheel."""
        # Detect Ctrl key for zoom (Windows/Linux)
        ctrl_down = (event.state & 0x4) != 0 if hasattr(event, "state") else False
        shift_down = (event.state & 0x1) != 0 if hasattr(event, "state") else False
        # Normalize delta across platforms
        if hasattr(event, "delta") and event.delta:
            delta = event.delta
        elif hasattr(event, "num"):
            delta = 120 if event.num == 4 else -120
        else:
            delta = 0
        
        if ctrl_down:
            zoom_factor = 1.1 if delta > 0 else 1 / 1.1
            self.apply_zoom(zoom_factor, event)
            return
        
        # Scroll horizontally when Shift is held, otherwise vertical
        if delta != 0:
            units = int(-1 * (delta / 120))
            if shift_down:
                self.canvas.xview_scroll(units, "units")
            else:
                self.canvas.yview_scroll(units, "units")
        # Use after() to debounce redraw
        if not self.needs_redraw:
            self.needs_redraw = True
            self.root.after(50, self.redraw_after_scroll)

    def apply_zoom(self, factor, event):
        """Apply zoom centered at mouse position."""
        new_zoom = max(self.zoom_min, min(self.zoom_max, self.zoom * factor))
        if new_zoom == self.zoom:
            return
        old_zoom = self.zoom
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        map_x = canvas_x / old_zoom
        map_y = canvas_y / old_zoom
        self.zoom = new_zoom
        # Update scroll region
        scroll_region = (0, 0, self.map_size * self.zoom, self.map_size * self.zoom)
        self.canvas.config(scrollregion=scroll_region)
        # Keep mouse position anchored during zoom
        new_canvas_x = map_x * new_zoom
        new_canvas_y = map_y * new_zoom
        max_w = self.map_size * new_zoom
        max_h = self.map_size * new_zoom
        new_scroll_x = max(0, min(new_canvas_x - event.x, max_w - 1))
        new_scroll_y = max(0, min(new_canvas_y - event.y, max_h - 1))
        if max_w > 0:
            self.canvas.xview_moveto(new_scroll_x / max_w)
        if max_h > 0:
            self.canvas.yview_moveto(new_scroll_y / max_h)
        if hasattr(self, "zoom_label"):
            self.zoom_label.config(text=f"Zoom: {int(self.zoom * 100)}%")
        self.needs_redraw = True

    def reset_zoom(self):
        """Reset zoom to 100% and rescale canvas."""
        if self.zoom == 1.0:
            return
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()
        if canvas_width <= 1 or canvas_height <= 1:
            canvas_width = self.map_size
            canvas_height = self.map_size
        center_x = self.canvas.canvasx(canvas_width / 2)
        center_y = self.canvas.canvasy(canvas_height / 2)
        map_x = center_x / self.zoom
        map_y = center_y / self.zoom
        self.zoom = 1.0
        self.canvas.config(scrollregion=(0, 0, self.map_size, self.map_size))
        new_center_x = map_x * self.zoom
        new_center_y = map_y * self.zoom
        max_w = self.map_size
        max_h = self.map_size
        new_scroll_x = max(0, min(new_center_x - canvas_width / 2, max_w - 1))
        new_scroll_y = max(0, min(new_center_y - canvas_height / 2, max_h - 1))
        if max_w > 0:
            self.canvas.xview_moveto(new_scroll_x / max_w)
        if max_h > 0:
            self.canvas.yview_moveto(new_scroll_y / max_h)
        if hasattr(self, "zoom_label"):
            self.zoom_label.config(text="Zoom: 100%")
        self.needs_redraw = True

    def get_zoomed_map_image(self):
        """Return a zoomed PhotoImage for display."""
        if self.map_image_zoomed is not None and self.map_image_zoom == self.zoom:
            return self.map_image_zoomed
        try:
            from PIL import ImageTk, Image
        except ImportError:
            return self.map_image
        if self.map_image is None:
            return None
        try:
            pil_img = ImageTk.getimage(self.map_image)
        except Exception:
            return self.map_image
        target_w = max(1, int(self.map_size * self.zoom))
        target_h = max(1, int(self.map_size * self.zoom))
        resized = pil_img.resize((target_w, target_h), resample=Image.NEAREST)
        self.map_image_zoomed = ImageTk.PhotoImage(resized)
        self.map_image_zoom = self.zoom
        return self.map_image_zoomed

    def get_tile_texture_tk(self, tile_id):
        """Return tile texture PhotoImage for current zoom."""
        if tile_id not in self.tile_textures:
            return None
        if self.zoom == 1.0:
            return self.tile_textures_tk.get(tile_id)
        key = (tile_id, self.zoom)
        if key in self.tile_textures_zoomed:
            return self.tile_textures_zoomed[key]
        try:
            from PIL import ImageTk, Image
        except ImportError:
            return self.tile_textures_tk.get(tile_id)
        base = self.tile_textures[tile_id]
        size = max(1, int(TILE_SIZE * self.zoom))
        resized = base.resize((size, size), resample=Image.NEAREST)
        tk_img = ImageTk.PhotoImage(resized)
        self.tile_textures_zoomed[key] = tk_img
        return tk_img

    def begin_action(self):
        if self.current_action is None:
            self.current_action = {}

    def record_change(self, row, col, old_value):
        if self.current_action is None:
            self.current_action = {}
        if (row, col) not in self.current_action:
            self.current_action[(row, col)] = old_value

    def end_action(self):
        if not self.current_action:
            self.current_action = None
            return
        changes = []
        for (row, col), old_value in self.current_action.items():
            new_value = self.tiles[row][col]
            if old_value != new_value:
                changes.append((row, col, old_value, new_value))
        if changes:
            self.undo_stack.append(changes)
            self.redo_stack.clear()
        self.current_action = None

    def apply_changes(self, changes, reverse=False):
        for row, col, old_value, new_value in changes:
            self.tiles[row][col] = old_value if reverse else new_value
            self.dirty_tile_list.add((row, col))
        self.image_cache_dirty = True
        self.needs_redraw = True

    def undo(self):
        if self.current_action:
            self.end_action()
        if not self.undo_stack:
            return
        changes = self.undo_stack.pop()
        self.apply_changes(changes, reverse=True)
        self.redo_stack.append(changes)

    def redo(self):
        if self.current_action:
            self.end_action()
        if not self.redo_stack:
            return
        changes = self.redo_stack.pop()
        self.apply_changes(changes, reverse=False)
        self.undo_stack.append(changes)
    
    def redraw_after_scroll(self):
        """Redraw map after scroll event"""
        self.needs_redraw = False
        # Only redraw editing tiles, background image stays
        self.draw_map()
    
    def draw_tile(self, row, col):
        """Mark tile as modified (cache will be updated on next draw_map call)"""
        # Mark cache as dirty - background image will be updated on next draw_map() call
        self.image_cache_dirty = True
        # No need to draw individual tile rectangles since background image contains all tiles
    
    def fill_selection(self):
        if not self.selection_start or not self.selection_end:
            messagebox.showwarning("No Selection", "Please select an area first (Shift+Click and drag)")
            return
        
        col1 = min(self.selection_start[0], self.selection_end[0])
        col2 = max(self.selection_start[0], self.selection_end[0])
        row1 = min(self.selection_start[1], self.selection_end[1])
        row2 = max(self.selection_start[1], self.selection_end[1])
        
        # Validate spawn limits for fill
        limit = self.spawn_limits.get(self.selected_tile)
        if limit is not None:
            current = self.count_tiles(self.selected_tile)
            to_replace = 0
            to_add = 0
            for row in range(row1, row2 + 1):
                for col in range(col1, col2 + 1):
                    if 0 <= row < self.tile_count and 0 <= col < self.tile_count:
                        if self.tiles[row][col] == self.selected_tile:
                            to_replace += 1
                        else:
                            to_add += 1
            if current - to_replace + to_add > limit:
                messagebox.showwarning(
                    "Limit Reached",
                    f"{TILE_TYPES[self.selected_tile]['name']} limit reached."
                )
                return

        # Fill area
        self.begin_action()
        for row in range(row1, row2 + 1):
            for col in range(col1, col2 + 1):
                if 0 <= row < self.tile_count and 0 <= col < self.tile_count:
                    if self.tiles[row][col] != self.selected_tile:
                        self.record_change(row, col, self.tiles[row][col])
                        self.tiles[row][col] = self.selected_tile
        
        # Track edited region
        for row in range(row1, row2 + 1):
            for col in range(col1, col2 + 1):
                self.dirty_tile_list.add((row, col))
        self.end_action()
        self.needs_redraw = True
        
        # Mark cache as dirty
        self.image_cache_dirty = True
        
        # Redraw affected area (marks cache dirty)
        for row in range(row1, row2 + 1):
            for col in range(col1, col2 + 1):
                self.draw_tile(row, col)
        
        # Update cache after editing
        self.needs_redraw = True
        
        # Clear selection
        self.selection_start = None
        self.selection_end = None
        self.canvas.delete("selection")
        self.selection_label.config(text="Selection: None")
    
    def on_size_change(self, event=None):
        new_size = int(self.size_var.get())
        if new_size != self.map_size:
            # Warn about large maps
            if new_size >= 2048:
                if not messagebox.askyesno("Large Map Warning", 
                                          f"Creating a {new_size}x{new_size} map will use significant memory.\n"
                                          f"This may take a moment. Continue?"):
                    # Reset to current size
                    self.size_var.set(str(self.map_size))
                    return
            
            if messagebox.askyesno("Change Map Size", 
                                  f"Changing map size will clear the current map. Continue?"):
                self.new_map(new_size)
            else:
                # Reset to current size if user cancels
                self.size_var.set(str(self.map_size))
    
    def save_map(self):
        if hasattr(self, 'current_file') and self.current_file:
            self.save_map_to_file(self.current_file)
        else:
            self.save_map_as()
    
    def save_map_as(self):
        filename = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialdir="maps"
        )
        if filename:
            self.save_map_to_file(filename)
            self.current_file = filename
    
    def save_map_to_file(self, filename):
        try:
            # Create maps directory if it doesn't exist
            os.makedirs(os.path.dirname(filename) if os.path.dirname(filename) else ".", exist_ok=True)
            
            map_data = {
                "version": "1.0",
                "mapSize": self.map_size,
                "tileSize": TILE_SIZE,
                "tiles": self.tiles
            }
            
            with open(filename, 'w') as f:
                json.dump(map_data, f, indent=2)
            
            messagebox.showinfo("Success", f"Map saved to {filename}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to save map: {str(e)}")
    
    def load_map(self):
        filename = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialdir="maps"
        )
        if filename:
            self.load_map_from_file(filename)
    
    def load_map_from_file(self, filename):
        try:
            with open(filename, 'r') as f:
                map_data = json.load(f)
            
            # Validate map data
            if "version" not in map_data or "mapSize" not in map_data or "tiles" not in map_data:
                raise ValueError("Invalid map file format")
            
            self.map_size = map_data["mapSize"]
            if self.map_size % TILE_SIZE != 0:
                raise ValueError("mapSize in file must be divisible by TILE_SIZE")
            self.tile_count = self.map_size // TILE_SIZE
            self.tiles = map_data["tiles"]
            self.size_var.set(str(self.map_size))
            self.current_file = filename
            
            # Validate tile values and dimensions
            if len(self.tiles) != self.tile_count or any(len(row) != self.tile_count for row in self.tiles):
                raise ValueError("Tile grid size does not match mapSize/tileSize")
            for row in self.tiles:
                for tile_id in row:
                    if tile_id not in TILE_TYPES:
                        raise ValueError(f"Invalid tile ID: {tile_id}")
            
            # Reset editing center
            self.current_editing_center = None
            
            # Mark cache as dirty and regenerate
            self.image_cache_dirty = True
            self.map_image = None
            self.map_image_id = None
            self.edited_region = None  # Reset edited region for full regeneration

            self.update_map_image_cache()
            self.draw_map()
            self.undo_stack.clear()
            self.redo_stack.clear()
            self.current_action = None
            messagebox.showinfo("Success", f"Map loaded from {filename}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to load map: {str(e)}")
    
    def show_profile_stats(self):
        """Show profiling statistics in a dialog"""
        stats = TimeProfiler.get_stats()
        
        if not stats:
            messagebox.showinfo("Profile Stats", "No profiling data collected yet.")
            return
        
        # Build stats text
        stats_text = "Time Profiling Statistics\n" + "=" * 50 + "\n\n"
        
        for name in sorted(stats.keys()):
            s = stats[name]
            stats_text += f"{name}:\n"
            stats_text += f"  Calls:   {s['count']}\n"
            stats_text += f"  Total:   {s['total']*1000:.2f}ms\n"
            stats_text += f"  Average: {s['avg']*1000:.2f}ms\n"
            stats_text += f"  Min:     {s['min']*1000:.2f}ms\n"
            stats_text += f"  Max:     {s['max']*1000:.2f}ms\n\n"
        
        # Also print to console
        TimeProfiler.print_summary()
        
        # Show in dialog
        dialog = tk.Toplevel(self.root)
        dialog.title("Profile Statistics")
        dialog.geometry("500x400")
        
        text_widget = tk.Text(dialog, wrap=tk.WORD, font=("Courier", 9))
        text_widget.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        text_widget.insert("1.0", stats_text)
        text_widget.config(state=tk.DISABLED)
        
        ttk.Button(dialog, text="Close", command=dialog.destroy).pack(pady=5)
    
    def clear_profile_data(self):
        """Clear all profiling data"""
        TimeProfiler.clear()
        messagebox.showinfo("Profile Data", "All profiling data has been cleared.")


def main():
    root = tk.Tk()
    app = MapEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
