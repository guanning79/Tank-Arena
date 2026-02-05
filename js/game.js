/**
 * Main Game Class
 * Handles the game loop and game state
 */
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.input = new InputHandler();
        this.container = document.getElementById('game-container');
        this.titleBar = document.getElementById('title-bar');
        this.scaleToggle = document.getElementById('scale-toggle');
        this.debugToggle = document.getElementById('debug-toggle');
        this.debugPanel = document.getElementById('debug-panel');
        this.playerTilePos = document.getElementById('player-tile-pos');
        this.spawnDebugLog = document.getElementById('spawn-debug-log');
        this.autoScale = false;
        this.showDebugBounds = false;
        this.spawnDebugLines = [];
        this.initialPlayerSpawnRect = null;
        this.mapPixelSize = 0;
        this.tileImages = {};
        this.aiSpawnIndex = 0;
        this.tankDefinitions = null;
        this.maxEnemyCount = 0;
        this.randomSeed = (Date.now() | 0) ^ 0x9e3779b9;
        this.fxConfig = null;
        this.fxConfigPromise = null;
        this.fxTextureCache = {};
        this.activeFx = [];
        this.pendingFxRequests = [];
        this.frameTick = 0;
        
        // Set canvas size
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        // Game state
        this.state = 'menu'; // menu, playing, gameOver
        this.score = 0;
        this.lastTimeMs = 0;
        this.accumulatorMs = 0;
        this.fixedTimeStepMs = 33; // ~30 FPS
        
        // Game entities
        this.player = null;
        this.bullets = [];
        this.enemies = [];
        this.mapData = null;
        this.mapLoadError = null;
        
        // Shooting
        this.shootCooldownTicks = 0;
        this.shootCooldownTicksMax = 9;
        
        // Enemy spawning
        this.enemySpawnTimerTicks = 0;
        this.enemySpawnIntervalTicks = 90;
        this.enemySpawnIntervalMinTicks = 30;
        this.enemySpawnIntervalStepTicks = 3;
        this.playerContactDamageAccumulator = 0;
        
        this.setupUI();
        this.init();
    }
    
    setupUI() {
        const startButton = document.getElementById('start-button');
        const restartButton = document.getElementById('restart-button');
        
        startButton.addEventListener('click', () => this.startGame());
        restartButton.addEventListener('click', () => this.startGame());

        if (this.scaleToggle) {
            this.scaleToggle.addEventListener('click', () => this.toggleScale());
        }
        if (this.debugToggle) {
            this.debugToggle.addEventListener('click', () => this.toggleDebugBounds());
        }
    }
    
    init() {
        // Initial setup
        this.updateUI();
        window.addEventListener('resize', () => this.applyScale());
        this.showDebugBounds = true;
        if (this.debugToggle) {
            this.debugToggle.textContent = 'Debug: On';
        }
        if (this.debugPanel) {
            this.debugPanel.classList.remove('hidden');
        }
        this.applyScale();
    }
    
    async startGame() {
        this.state = 'playing';
        this.score = 0;
        this.bullets = [];
        this.enemies = [];
        this.shootCooldownTicks = 0;
        this.enemySpawnTimerTicks = 0;
        this.playerContactDamageAccumulator = 0;
        
        await this.loadInitialMap();
        await this.loadTankDefinitions();
        
        // Create player tank
        const spawnPosition = this.getSpawnPositionForTank('normal_pl', TILE_TYPES.PLAYER_SPAWN);
        this.player = this.createTankFromDefinition('normal_pl', spawnPosition.x, spawnPosition.y, '#4CAF50');
        
        // Hide/show screens
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        
        this.updateUI();
        this.gameLoop(performance.now());
    }

    async loadInitialMap() {
        const config = window.GAME_CONFIG || {};
        const mapPath = this.normalizeMapPath(config.initialMap || 'maps/Stage01.json');
        
        try {
            this.mapData = await loadMap(mapPath);
            this.mapLoadError = null;
            if (this.mapData && this.mapData.mapSize) {
                this.mapPixelSize = this.mapData.mapSize;
                this.canvas.width = this.mapData.mapSize;
                this.canvas.height = this.mapData.mapSize;
            }
            this.maxEnemyCount = this.mapData
                ? this.mapData.getSpawnPoints(TILE_TYPES.AI_SPAWN).length
                : 0;
            this.aiSpawnIndex = 0;
            await this.loadTileImages();
            this.applyScale();
        } catch (error) {
            this.mapData = null;
            this.mapLoadError = error;
            console.error('Failed to load initial map:', error);
        }
    }

    async loadTankDefinitions() {
        if (this.tankDefinitions) return;
        const tankRoot = typeof TANK_DATA_ROOT !== 'undefined' ? TANK_DATA_ROOT : 'tanks';
        const response = await fetch(`${tankRoot}/tanks.json`);
        if (!response.ok) {
            throw new Error(`Failed to load tanks.json: ${response.statusText}`);
        }
        const data = await response.json();
        this.tankDefinitions = {};
        const texturePromises = data.map((def) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ def, img });
            img.onerror = () => resolve({ def, img: null });
            img.src = `${tankRoot}/${def.texture}`;
        }));
        const results = await Promise.all(texturePromises);
        results.forEach(({ def, img }) => {
            const processed = img ? this.createAlphaMaskedImage(img, 12) : null;
            this.tankDefinitions[def.tank_label] = {
                ...def,
                textureImage: processed || img
            };
        });
    }

    async loadFxConfig() {
        if (this.fxConfigPromise) return this.fxConfigPromise;
        this.fxConfigPromise = fetch('fx/effects.json', { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load fx/effects.json: ${response.statusText}`);
                }
                return response.json();
            })
            .then((data) => {
                this.fxConfig = data || {};
                if (this.pendingFxRequests.length) {
                    const pending = [...this.pendingFxRequests];
                    this.pendingFxRequests = [];
                    pending.forEach((request) => {
                        this.playFx(request.name, request.x, request.y);
                    });
                }
                return this.fxConfig;
            })
            .catch((error) => {
                console.error('Failed to load effects config:', error);
                this.fxConfig = {};
                return this.fxConfig;
            });
        return this.fxConfigPromise;
    }

    ensureFxTexture(texturePath) {
        if (this.fxTextureCache[texturePath]) {
            return this.fxTextureCache[texturePath];
        }
        const img = new Image();
        const entry = { img, processed: null };
        img.onload = () => {
            entry.processed = this.createAlphaMaskedImage(img, 12);
        };
        img.src = texturePath;
        this.fxTextureCache[texturePath] = entry;
        return entry;
    }

    playFx(name, x, y) {
        if (!this.fxConfig) {
            this.pendingFxRequests.push({ name, x, y });
            this.loadFxConfig();
            return;
        }
        const config = this.fxConfig[name];
        if (!config) return;
        const texturePath = config.texture || 'fx/hit.png';
        const image = this.ensureFxTexture(texturePath);
        this.activeFx.push({
            name,
            x,
            y,
            startTick: this.frameTick,
            config,
            image
        });
    }

    createAlphaMaskedImage(img, threshold = 12) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r <= threshold && g <= threshold && b <= threshold) {
                data[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    createTankFromDefinition(label, x, y, fallbackColor) {
        const def = this.tankDefinitions ? this.tankDefinitions[label] : null;
        const tileSize = this.mapData ? this.mapData.tileSize : null;
        if (!def) {
            return new Tank(x, y, { color: fallbackColor, tileSize });
        }
        return new Tank(x, y, {
            color: fallbackColor,
            textureImage: def.textureImage,
            boundMin: def.bound_min || null,
            boundMax: def.bound_max || null,
            speed: def.speed,
            shellSize: def.shell_size,
            shellSpeed: def.shell_speed,
            shellColor: def.shell_color,
            tileSize
        });
    }

    async loadTileImages() {
        const tileIds = Object.values(TILE_TYPES);
        const loadPromises = tileIds.map((tileId) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ tileId, img });
            img.onerror = () => resolve({ tileId, img: null });
            img.src = `maps/tiles/${tileId}.png`;
        }));
        
        const results = await Promise.all(loadPromises);
        this.tileImages = {};
        results.forEach(({ tileId, img }) => {
            if (!img) return;
            if (tileId === TILE_TYPES.GRASS) {
                this.tileImages[tileId] = this.createAlphaMaskedImage(img, 12);
                return;
            }
            this.tileImages[tileId] = img;
        });
    }
    
    normalizeMapPath(mapPath) {
        if (!mapPath) return 'maps/Stage01.json';
        const normalized = String(mapPath).trim().replace(/^@/, '');
        if (!normalized.includes('/')) {
            return `maps/${normalized}`;
        }
        return normalized;
    }
    
    getSpawnPositionForTank(label, spawnType, spawnOverride = null) {
        const isPlayerSpawn = label === 'normal_pl';
        if (isPlayerSpawn) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/c24df486-cd02-4e17-aeed-17294a2ea336',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'js/game.js:getSpawnPositionForTank',message:'entry',data:{label,spawnType,hasMap:!!this.mapData,hasDefs:!!this.tankDefinitions},timestamp:Date.now(),sessionId:'debug-session',runId:'spawn-debug',hypothesisId:'H1'})}).catch(()=>{});
            // #endregion
        }
        if (!this.mapData) {
            return { x: this.canvas.width / 2, y: this.canvas.height / 2 };
        }
        const spawns = this.mapData.getSpawnPoints(spawnType);
        if (spawns.length === 0) {
            return { x: this.canvas.width / 2, y: this.canvas.height / 2 };
        }
        const def = this.tankDefinitions ? this.tankDefinitions[label] : null;
        const { tileSize } = this.mapData;
        const spawn = spawnOverride || spawns[0];
        const tankSize = typeof TANK_IMG_SIZE !== 'undefined' ? TANK_IMG_SIZE : 40;
        const mapSize = this.mapData.mapSize;
        const position = {
            x: spawn.col * tileSize,
            y: spawn.row * tileSize
        };
        const bounds = null;
        if (isPlayerSpawn) {
            this.clearSpawnDebugLog();
            this.appendSpawnDebugLine(`spawn tile: (${spawn.col}, ${spawn.row})`);
            this.appendSpawnDebugLine(`spawn top-left px: (${position.x}, ${position.y})`);
        }

        const getCollisionDepths = (rect) => {
            const depths = { left: 0, right: 0, up: 0, down: 0 };
            if (rect.x < 0) depths.left = Math.max(depths.left, -rect.x);
            if (rect.y < 0) depths.up = Math.max(depths.up, -rect.y);
            if (rect.x + rect.w > mapSize) depths.right = Math.max(depths.right, rect.x + rect.w - mapSize);
            if (rect.y + rect.h > mapSize) depths.down = Math.max(depths.down, rect.y + rect.h - mapSize);
            if (bounds) {
                if (rect.x < bounds.minX) depths.left = Math.max(depths.left, bounds.minX - rect.x);
                if (rect.y < bounds.minY) depths.up = Math.max(depths.up, bounds.minY - rect.y);
                if (rect.x > bounds.maxX) depths.right = Math.max(depths.right, rect.x - bounds.maxX);
                if (rect.y > bounds.maxY) depths.down = Math.max(depths.down, rect.y - bounds.maxY);
            }

            const tilesPerSide = this.mapData.tilesPerSide;
            let colStart = Math.floor(rect.x / tileSize);
            let colEnd = Math.floor((rect.x + rect.w - 1) / tileSize);
            let rowStart = Math.floor(rect.y / tileSize);
            let rowEnd = Math.floor((rect.y + rect.h - 1) / tileSize);

            colStart = Math.max(0, colStart);
            rowStart = Math.max(0, rowStart);
            colEnd = Math.min(tilesPerSide - 1, colEnd);
            rowEnd = Math.min(tilesPerSide - 1, rowEnd);

            if (colStart > colEnd || rowStart > rowEnd) {
                return depths;
            }

            for (let row = rowStart; row <= rowEnd; row++) {
                for (let col = colStart; col <= colEnd; col++) {
                    if (!this.mapData.isAccessible(row, col)) {
                        const tileLeft = col * tileSize;
                        const tileRight = tileLeft + tileSize;
                        const tileTop = row * tileSize;
                        const tileBottom = tileTop + tileSize;
                        const rectLeft = rect.x;
                        const rectRight = rect.x + rect.w;
                        const rectTop = rect.y;
                        const rectBottom = rect.y + rect.h;

                        const overlapX = Math.min(rectRight, tileRight) - Math.max(rectLeft, tileLeft);
                        const overlapY = Math.min(rectBottom, tileBottom) - Math.max(rectTop, tileTop);
                        if (overlapX > 0 && overlapY > 0) {
                            const penLeft = rectRight - tileLeft;
                            const penRight = tileRight - rectLeft;
                            const penUp = rectBottom - tileTop;
                            const penDown = tileBottom - rectTop;
                            const minHoriz = Math.min(penLeft, penRight);
                            const minVert = Math.min(penUp, penDown);

                            if (minHoriz <= minVert) {
                                if (penLeft <= penRight) {
                                    depths.left = Math.max(depths.left, penLeft);
                                } else {
                                    depths.right = Math.max(depths.right, penRight);
                                }
                            } else {
                                if (penUp <= penDown) {
                                    depths.up = Math.max(depths.up, penUp);
                                } else {
                                    depths.down = Math.max(depths.down, penDown);
                                }
                            }
                        }
                    }
                }
            }
            return depths;
        };

        const isFree = (rect) => {
            const depths = getCollisionDepths(rect);
            return !depths.left && !depths.right && !depths.up && !depths.down;
        };

        let selectedRect = null;
        for (let offsetRow = -1; offsetRow <= 1 && !selectedRect; offsetRow += 1) {
            for (let offsetCol = -1; offsetCol <= 1 && !selectedRect; offsetCol += 1) {
                const testCol = spawn.col + offsetCol;
                const testRow = spawn.row + offsetRow;
                const testPosition = {
                    x: testCol * tileSize,
                    y: testRow * tileSize
                };
                const testRect = this.getTankBoundRectFromTopLeft(
                    testPosition.x,
                    testPosition.y,
                    def,
                    tankSize
                );
                if (isFree(testRect)) {
                    selectedRect = testRect;
                }
            }
        }

        if (!selectedRect) {
            const spawnName = spawnType === TILE_TYPES.AI_SPAWN ? 'AI Tank Spawn' : 'Player Spawn';
            this.appendSpawnDebugLine(`spawn failed: label=${label} tile=(${spawn.col},${spawn.row})`);
            window.alert(`Invalid spawn position at ${spawnName} (${spawn.col}, ${spawn.row}).`);
            selectedRect = this.getTankBoundRectFromTopLeft(position.x, position.y, def, tankSize);
        }

        const tankTopLeft = {
            x: selectedRect.x - (def && def.bound_min ? def.bound_min.x : 0),
            y: selectedRect.y - (def && def.bound_min ? def.bound_min.y : 0)
        };
        const result = {
            x: tankTopLeft.x + (tankSize >> 1),
            y: tankTopLeft.y + (tankSize >> 1)
        };
        if (isPlayerSpawn) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/c24df486-cd02-4e17-aeed-17294a2ea336',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'js/game.js:getSpawnPositionForTank',message:'exit',data:{result,rect:selectedRect},timestamp:Date.now(),sessionId:'debug-session',runId:'spawn-debug',hypothesisId:'H3'})}).catch(()=>{});
            // #endregion
            this.appendSpawnDebugLine(`final rect: x=${selectedRect.x}, y=${selectedRect.y}, w=${selectedRect.w}, h=${selectedRect.h}`);
            this.appendSpawnDebugLine(`spawn center: (${result.x}, ${result.y})`);
        }
        return result;
    }

    getRandomInt(max) {
        if (max <= 0) return 0;
        this.randomSeed = (Math.imul(this.randomSeed, 1664525) + 1013904223) | 0;
        return (this.randomSeed >>> 0) % max;
    }

    clampSpawnToBounds(spawn, def) {
        if (!def || !def.bound_min || !def.bound_max) {
            return spawn;
        }
        return {
            row: Math.min(Math.max(spawn.row, def.bound_min.y), def.bound_max.y),
            col: Math.min(Math.max(spawn.col, def.bound_min.x), def.bound_max.x)
        };
    }

    filterSpawnsWithinBounds(spawns, def) {
        if (!def || !def.bound_min || !def.bound_max) {
            return spawns;
        }
        return spawns.filter((spawn) => (
            spawn.col >= def.bound_min.x
            && spawn.col <= def.bound_max.x
            && spawn.row >= def.bound_min.y
            && spawn.row <= def.bound_max.y
        ));
    }

    clampPositionToTankBounds(position, def) {
        if (!def || !def.bound_min || !def.bound_max || !this.mapData) {
            return position;
        }
        const tileSize = this.mapData.tileSize;
        const minX = def.bound_min.x * tileSize + tileSize / 2;
        const maxX = def.bound_max.x * tileSize + tileSize / 2;
        const minY = def.bound_min.y * tileSize + tileSize / 2;
        const maxY = def.bound_max.y * tileSize + tileSize / 2;
        return {
            x: Math.min(Math.max(position.x, minX), maxX),
            y: Math.min(Math.max(position.y, minY), maxY)
        };
    }

    getMapBounds() {
        const size = this.mapData && this.mapData.mapSize
            ? this.mapData.mapSize
            : (this.mapPixelSize || Math.max(this.canvas.width, this.canvas.height));
        return { width: size, height: size };
    }

    canTankOccupy(x, y, tank) {
        if (!this.mapData || !this.mapData.isAccessible) return true;
        const boundRect = tank.getBoundRectAt(x, y);
        const points = [
            { x: boundRect.x + 1, y: boundRect.y + 1 },
            { x: boundRect.x + boundRect.w - 1, y: boundRect.y + 1 },
            { x: boundRect.x + 1, y: boundRect.y + boundRect.h - 1 },
            { x: boundRect.x + boundRect.w - 1, y: boundRect.y + boundRect.h - 1 }
        ];
        const tilesClear = points.every((point) => {
            const tile = this.mapData.pixelToTile(point.x, point.y);
            return this.mapData.isAccessible(tile.row, tile.col);
        });
        if (!tilesClear) return false;

        const overlapsTank = this.isTankOverlappingRect(boundRect, tank);
        return !overlapsTank;
    }

    isTankOverlappingRect(rect, ignoreTank) {
        const tanks = [];
        if (this.player && this.player.isAlive()) tanks.push(this.player);
        this.enemies.forEach((enemy) => {
            if (enemy && enemy.isAlive()) tanks.push(enemy);
        });
        for (let i = 0; i < tanks.length; i += 1) {
            const tank = tanks[i];
            if (tank === ignoreTank) continue;
            const otherRect = tank.getBoundRect();
            if (!otherRect) continue;
            const separated =
                rect.x + rect.w <= otherRect.x
                || rect.x >= otherRect.x + otherRect.w
                || rect.y + rect.h <= otherRect.y
                || rect.y >= otherRect.y + otherRect.h;
            if (!separated) return true;
        }
        return false;
    }

    getTankBoundRectFromTopLeft(x, y, def, tankSize) {
        if (!def || !def.bound_min || !def.bound_max) {
            return { x, y, w: tankSize, h: tankSize };
        }
        return {
            x: x + def.bound_min.x,
            y: y + def.bound_min.y,
            w: Math.max(0, def.bound_max.x - def.bound_min.x + 1),
            h: Math.max(0, def.bound_max.y - def.bound_min.y + 1)
        };
    }
    
    toggleScale() {
        this.autoScale = !this.autoScale;
        if (this.scaleToggle) {
            this.scaleToggle.textContent = this.autoScale ? 'Scale: On' : 'Scale: Off';
        }
        this.applyScale();
    }

    toggleDebugBounds() {
        this.showDebugBounds = !this.showDebugBounds;
        if (this.debugToggle) {
            this.debugToggle.textContent = this.showDebugBounds ? 'Debug: On' : 'Debug: Off';
        }
        if (this.debugPanel) {
            this.debugPanel.classList.toggle('hidden', !this.showDebugBounds);
        }
        if (!this.showDebugBounds) {
            this.clearSpawnDebugLog();
            this.initialPlayerSpawnRect = null;
        }
    }

    updatePlayerTilePos() {
        if (!this.playerTilePos || !this.showDebugBounds || !this.player || !this.mapData) return;
        const tileSize = this.mapData.tileSize;
        const boundRect = this.player.getBoundRect();
        const left = boundRect ? boundRect.x : (this.player.x - this.player.width / 2);
        const top = boundRect ? boundRect.y : (this.player.y - this.player.height / 2);
        const col = Math.floor(left / tileSize);
        const row = Math.floor(top / tileSize);
        this.playerTilePos.textContent = `Tile: (${col}, ${row})`;
    }

    clearSpawnDebugLog() {
        this.spawnDebugLines = [];
        if (this.spawnDebugLog) {
            this.spawnDebugLog.textContent = '';
        }
        this.initialPlayerSpawnRect = null;
    }

    appendSpawnDebugLine(line) {
        if (!this.showDebugBounds || !this.spawnDebugLog) return;
        this.spawnDebugLines.push(line);
        if (this.spawnDebugLines.length > 80) {
            this.spawnDebugLines.shift();
        }
        this.spawnDebugLog.textContent = this.spawnDebugLines.join('\n');
    }
    
    applyScale() {
        if (!this.container) return;
        const mapSize = this.mapPixelSize || Math.max(this.canvas.width, this.canvas.height);
        const effectiveMapSize = this.mapData && this.mapData.mapSize ? this.mapData.mapSize : mapSize;
        const titleBarHeight = this.titleBar ? this.titleBar.offsetHeight : 0;
        let scale = 1;
        if (this.autoScale) {
            const availableHeight = Math.max(0, window.innerHeight - titleBarHeight);
            const scaleX = window.innerWidth / effectiveMapSize;
            const scaleY = availableHeight / effectiveMapSize;
            scale = Math.min(scaleX, scaleY);
        }
        const scaledSize = effectiveMapSize * scale;
        this.container.style.width = `${scaledSize}px`;
        this.container.style.height = `${scaledSize + titleBarHeight}px`;
        this.canvas.style.width = `${scaledSize}px`;
        this.canvas.style.height = `${scaledSize}px`;
    }
    
    gameLoop(currentTime) {
        if (this.state !== 'playing') return;
        
        requestAnimationFrame((time) => this.gameLoop(time));
        
        const currentMs = Math.floor(currentTime);
        if (!this.lastTimeMs) {
            this.lastTimeMs = currentMs;
        }
        let deltaMs = currentMs - this.lastTimeMs;
        if (deltaMs < 0) deltaMs = 0;
        if (deltaMs > 100) deltaMs = 100;
        this.lastTimeMs = currentMs;
        
        // Fixed timestep update
        this.accumulatorMs += deltaMs;
        let didUpdate = false;
        while (this.accumulatorMs >= this.fixedTimeStepMs) {
            this.update();
            this.accumulatorMs -= this.fixedTimeStepMs;
            didUpdate = true;
        }
        
        // Render only when a fixed update occurred
        if (didUpdate) {
            this.render();
        }
    }
    
    update() {
        if (this.state !== 'playing') return;
        this.frameTick += 1;
        
        const bounds = this.getMapBounds();
        const controlEvents = this.input.getControlEvents();
        
        // Update player
        if (this.player && this.player.isAlive()) {
            this.player.update(
                controlEvents,
                bounds,
                (x, y) => this.canTankOccupy(x, y, this.player),
                this.mapData
            );
            const halfPlayerW = this.player.width >> 1;
            const halfPlayerH = this.player.height >> 1;
            this.player.x = Math.max(halfPlayerW, Math.min(this.player.x, bounds.width - halfPlayerW));
            this.player.y = Math.max(halfPlayerH, Math.min(this.player.y, bounds.height - halfPlayerH));
            
            // Shooting
            if (this.shootCooldownTicks > 0) {
                this.shootCooldownTicks -= 1;
            }
            if (controlEvents.includes('fire') && this.shootCooldownTicks <= 0) {
                this.shoot();
                this.shootCooldownTicks = this.shootCooldownTicksMax;
            }
        } else {
            // Player died
            this.gameOver();
            return;
        }
        
        // Update bullets
        this.bullets.forEach(bullet => bullet.update(bounds, this.mapData));
        this.bullets = this.bullets.filter(bullet => bullet.active);
        
        // Spawn enemies
        this.enemySpawnTimerTicks += 1;
        if (this.enemySpawnTimerTicks >= this.enemySpawnIntervalTicks) {
            this.spawnEnemy();
            this.enemySpawnTimerTicks = 0;
            // Increase spawn rate over time
            this.enemySpawnIntervalTicks = Math.max(
                this.enemySpawnIntervalMinTicks,
                this.enemySpawnIntervalTicks - this.enemySpawnIntervalStepTicks
            );
        }
        
        // Update enemies
        this.enemies.forEach(enemy => {
            if (enemy.isAlive()) {
                // Simple AI: move towards player
                const dx = this.player.x - enemy.x;
                const dy = this.player.y - enemy.y;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                let stepX = 0;
                let stepY = 0;
                
                if (absDx >= absDy) {
                    stepX = dx === 0 ? 0 : (dx > 0 ? enemy.speed : -enemy.speed);
                } else {
                    stepY = dy === 0 ? 0 : (dy > 0 ? enemy.speed : -enemy.speed);
                }
                
                if (stepX !== 0 || stepY !== 0) {
                    const nextX = enemy.x + stepX;
                    const nextY = enemy.y + stepY;
                    if (this.canTankOccupy(nextX, enemy.y, enemy)) {
                        enemy.x = nextX;
                    }
                    if (this.canTankOccupy(enemy.x, nextY, enemy)) {
                        enemy.y = nextY;
                    }
                    if (stepX !== 0) {
                        enemy.setDirection(stepX > 0 ? 1 : -1, 0);
                    } else if (stepY !== 0) {
                        enemy.setDirection(0, stepY > 0 ? 1 : -1);
                    }
                }

                const halfEnemyW = enemy.width >> 1;
                const halfEnemyH = enemy.height >> 1;
                enemy.x = Math.max(halfEnemyW, Math.min(enemy.x, bounds.width - halfEnemyW));
                enemy.y = Math.max(halfEnemyH, Math.min(enemy.y, bounds.height - halfEnemyH));
            }
        });
        
        // Collision detection: bullets vs enemies
        this.bullets.forEach(bullet => {
            if (!bullet.active) return;
            
            this.enemies.forEach(enemy => {
                if (bullet.checkCollision(enemy) && bullet.owner !== enemy) {
                    enemy.takeDamage(25);
                    bullet.active = false;
                    
                    if (!enemy.isAlive()) {
                        this.score += 100;
                        this.updateUI();
                    }
                }
            });
        });
        
        // Collision detection: enemies vs player
        this.enemies.forEach(enemy => {
            if (!enemy.isAlive()) return;
            
            const dx = this.player.x - enemy.x;
            const dy = this.player.y - enemy.y;
            const sumR = (this.player.width >> 1) + (enemy.width >> 1);
            if ((dx * dx + dy * dy) < (sumR * sumR)) {
                this.playerContactDamageAccumulator =
                    (this.playerContactDamageAccumulator || 0) + 10;
                while (this.playerContactDamageAccumulator >= 30) {
                    this.player.takeDamage(1);
                    this.playerContactDamageAccumulator -= 30;
                }
                this.updateUI();
            }
        });
        
        // Remove dead enemies
        this.enemies = this.enemies.filter(enemy => enemy.isAlive());

        // Update active effects
        if (this.activeFx.length) {
            const remaining = [];
            this.activeFx.forEach((fx) => {
                const frameIndex = this.frameTick - fx.startTick;
                if (frameIndex < (fx.config.frameCount || 0)) {
                    remaining.push(fx);
                }
            });
            this.activeFx = remaining;
        }
    }
    
    shoot() {
        if (!this.player || !this.player.isAlive()) return;
        
        const shellRadius = typeof this.player.shellSize === 'number' ? this.player.shellSize : 5;
        const halfW = this.player.width >> 1;
        const halfH = this.player.height >> 1;
        const offsetX = this.player.dirX * (halfW + shellRadius + 8);
        const offsetY = this.player.dirY * (halfH + shellRadius + 8);
        const bulletX = this.player.x + offsetX;
        const bulletY = this.player.y + offsetY;
        
        const bulletSpeed = typeof this.player.shellSpeed === 'number' ? this.player.shellSpeed : 10;
        const bullet = new Bullet(
            bulletX,
            bulletY,
            this.player.dirX,
            this.player.dirY,
            bulletSpeed,
            this.player,
            { radius: shellRadius, color: this.player.shellColor }
        );
        this.bullets.push(bullet);
    }
    
    spawnEnemy() {
        if (!this.mapData) return;
        if (this.maxEnemyCount <= 0 || this.enemies.length >= this.maxEnemyCount) return;
        const spawns = this.mapData.getSpawnPoints(TILE_TYPES.AI_SPAWN);
        if (spawns.length === 0) return;
        const spawnIndex = this.getRandomInt(spawns.length);
        const spawnPosition = this.getSpawnPositionForTank('normal_en', TILE_TYPES.AI_SPAWN, spawns[spawnIndex]);
        const enemy = this.createTankFromDefinition('normal_en', spawnPosition.x, spawnPosition.y, '#F44336');
        if (this.canTankOccupy(spawnPosition.x, spawnPosition.y, enemy)) {
            this.enemies.push(enemy);
        }
    }

    drawPlayerCollisionBox() {
        if (!this.player || !this.showDebugBounds) return;
        this.ctx.save();
        this.ctx.strokeStyle = '#00FFFF';
        this.ctx.lineWidth = 2;
        const boundRect = this.player.getBoundRect();
        if (boundRect) {
            this.ctx.strokeRect(boundRect.x, boundRect.y, boundRect.w, boundRect.h);
        } else {
            const x = this.player.x - this.player.width / 2;
            const y = this.player.y - this.player.height / 2;
            this.ctx.strokeRect(x, y, this.player.width, this.player.height);
        }
        this.ctx.restore();
    }

    drawEnemyCollisionBoxes() {
        if (!this.showDebugBounds) return;
        this.ctx.save();
        this.ctx.strokeStyle = '#FF00FF';
        this.ctx.lineWidth = 2;
        this.enemies.forEach((enemy) => {
            const boundRect = enemy.getBoundRect();
            if (boundRect) {
                this.ctx.strokeRect(boundRect.x, boundRect.y, boundRect.w, boundRect.h);
            } else {
                const x = enemy.x - enemy.width / 2;
                const y = enemy.y - enemy.height / 2;
                this.ctx.strokeRect(x, y, enemy.width, enemy.height);
            }
        });
        this.ctx.restore();
    }

    drawInitialPlayerSpawnRect() {
        if (!this.showDebugBounds || !this.initialPlayerSpawnRect) return;
        this.ctx.save();
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 2;
        const rect = this.initialPlayerSpawnRect;
        this.ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        this.ctx.restore();
    }

    drawBlockingTileBounds() {
        if (!this.showDebugBounds || !this.mapData) return;
        const { tiles, tileSize } = this.mapData;
        this.ctx.save();
        this.ctx.strokeStyle = '#FF4500';
        this.ctx.lineWidth = 1;
        for (let row = 0; row < tiles.length; row++) {
            for (let col = 0; col < tiles[row].length; col++) {
                if (!this.mapData.isAccessible(row, col)) {
                    this.ctx.strokeRect(col * tileSize, row * tileSize, tileSize, tileSize);
                }
            }
        }
        this.ctx.restore();
    }
    
    render() {
        // Clear canvas
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw map and grid background
        this.drawMap();
        if (this.showDebugBounds) {
            this.drawGrid();
        }
        
        if (this.state === 'playing') {
            // Draw player
            if (this.player && this.player.isAlive()) {
                this.player.draw(this.ctx);
            }
            this.drawPlayerCollisionBox();
            this.drawEnemyCollisionBoxes();
            this.updatePlayerTilePos();
            this.drawInitialPlayerSpawnRect();
            
            // Draw bullets
            this.bullets.forEach(bullet => bullet.draw(this.ctx));
            
            // Draw enemies
            this.enemies.forEach(enemy => enemy.draw(this.ctx));
        }
        this.drawGrassOverlay();
        this.drawBlockingTileBounds();
        this.drawFx();
    }

    drawFx() {
        if (!this.activeFx.length) return;
        this.activeFx.forEach((fx) => {
            const frameIndex = this.frameTick - fx.startTick;
            if (frameIndex < 0) return;
            const frameCount = fx.config.frameCount || 0;
            if (!frameCount || frameIndex >= frameCount) return;
            const sourceImage = fx.image.processed || (fx.image.img && fx.image.img.complete ? fx.image.img : null);
            if (!sourceImage) return;
            const scaleByFrame = Array.isArray(fx.config.scaleByFrame)
                ? fx.config.scaleByFrame
                : null;
            const scale = scaleByFrame
                ? (scaleByFrame[frameIndex] ?? scaleByFrame[scaleByFrame.length - 1] ?? 1)
                : 1;
            const width = sourceImage.width * scale;
            const height = sourceImage.height * scale;
            const x = fx.x - width / 2;
            const y = fx.y - height / 2;
            this.ctx.drawImage(sourceImage, x, y, width, height);
        });
    }
    
    drawMap() {
        if (!this.mapData) return;
        
        const { tiles, tileSize } = this.mapData;
        
        for (let row = 0; row < tiles.length; row++) {
            for (let col = 0; col < tiles[row].length; col++) {
                const tileId = tiles[row][col];
                const props = TILE_PROPERTIES[tileId];
                if (!props || props.invisible) continue;
                
                const tileImage = this.tileImages[tileId];
                if (tileImage) {
                    this.ctx.drawImage(tileImage, col * tileSize, row * tileSize, tileSize, tileSize);
                } else {
                    this.ctx.fillStyle = props.color || '#000';
                    this.ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
                }
            }
        }
    }

    drawGrassOverlay() {
        if (!this.mapData) return;
        const { tiles, tileSize } = this.mapData;
        for (let row = 0; row < tiles.length; row++) {
            for (let col = 0; col < tiles[row].length; col++) {
                const tileId = tiles[row][col];
                const props = TILE_PROPERTIES[tileId];
                if (!props || !props.invisible) continue;
                const tileImage = this.tileImages[tileId];
                if (tileImage) {
                    this.ctx.drawImage(tileImage, col * tileSize, row * tileSize, tileSize, tileSize);
                } else {
                    this.ctx.fillStyle = props.color || '#000';
                    this.ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
                }
            }
        }
    }
    
    drawGrid() {
        this.ctx.strokeStyle = '#2a2a4e';
        this.ctx.lineWidth = 1;
        
        const gridSize = 50;
        
        // Vertical lines
        for (let x = 0; x < this.canvas.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let y = 0; y < this.canvas.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }
    
    updateUI() {
        document.getElementById('score').textContent = `Score: ${this.score}`;
        if (this.player) {
            document.getElementById('health').textContent = `Health: ${Math.ceil(this.player.health)}`;
        }
    }
    
    gameOver() {
        this.state = 'gameOver';
        document.getElementById('final-score').textContent = `Final Score: ${this.score}`;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    window.__game = game;
    window.RenderFx = (name, x, y) => {
        if (!window.__game) return;
        window.__game.playFx(name, x, y);
    };
});
