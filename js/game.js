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
        this.aiDebugPanel = document.getElementById('ai-debug-panel');
        this.aiDebugState = document.getElementById('ai-debug-state');
        this.aiDebugAction = document.getElementById('ai-debug-action');
        this.aiDebugReward = document.getElementById('ai-debug-reward');
        this.aiDebugEpsilon = document.getElementById('ai-debug-epsilon');
        this.aiDebugLoss = document.getElementById('ai-debug-loss');
        this.aiDebugSteps = document.getElementById('ai-debug-steps');
        this.aiDebugEpisodes = document.getElementById('ai-debug-episodes');
        this.aiDebugBuildState = document.getElementById('ai-debug-build-state');
        this.aiDebugSentObserve = document.getElementById('ai-debug-sent-observe');
        this.aiDebugWorkerAction = document.getElementById('ai-debug-worker-action');
        this.aiDebugReturnedAction = document.getElementById('ai-debug-returned-action');
        this.autoScale = true;
        this.showDebugBounds = false;
        this.showAIDebug = false;
        this.spawnDebugLines = [];
        this.initialPlayerSpawnRect = null;
        this.mapPixelSize = 0;
        this.tileImages = {};
        this.aiSpawnIndex = 0;
        this.tankDefinitions = null;
        this.maxEnemyCount = 0;
        this.randomSeed = (Date.now() | 0) ^ 0x9e3779b9;
        this.fx = new FxManager(this.ctx);
        this.playerHQ = null;
        this.gameOverStarted = false;
        this.gameOverFxName = 'destroy_hq';

        // Deep RL
        this.rlAgent = null;
        this.rlEnabled = false;
        this.rlEnemyData = new Map();
        this.rlEnemyIdCounter = 0;
        
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
        this.shootCooldownTicksMax = 0;
        
        // Enemy spawning
        this.enemySpawnTimerTicks = 0;
        this.enemySpawnIntervalTicks = 90;
        this.enemySpawnIntervalMinTicks = 30;
        this.enemySpawnIntervalStepTicks = 3;
        this.playerContactDamageAccumulator = 0;
        this.playerPrevMoved = false;
        this.gameTicks = 0;
        this.enemiesDestroyed = 0;
        this.gameOverStarted = false;
        this.playerRespawnsRemaining = 0;
        
        this.setupUI();
        this.init();
    }
    
    setupUI() {
        const startButton = document.getElementById('start-button');
        const restartButton = document.getElementById('restart-button');
        const debugAiToggle = document.getElementById('debug-ai-toggle');
        
        startButton.addEventListener('click', () => this.startGame());
        restartButton.addEventListener('click', () => this.startGame());

        if (this.scaleToggle) {
            this.scaleToggle.addEventListener('click', () => this.toggleScale());
        }
        if (this.debugToggle) {
            this.debugToggle.addEventListener('click', () => this.toggleDebugBounds());
        }
        if (debugAiToggle) {
            debugAiToggle.addEventListener('click', () => this.toggleAIDebug());
        }
    }
    
    init() {
        // Initial setup
        this.updateUI();
        const config = window.GAME_CONFIG || {};
        if (this.fx && typeof config.sfxVolume === 'number') {
            this.fx.setVolume(config.sfxVolume);
        }
        window.addEventListener('resize', () => this.applyScale());
        this.showDebugBounds = false;
        if (this.debugToggle) {
            this.debugToggle.textContent = 'Debug: Off';
        }
        if (this.debugPanel) {
            this.debugPanel.classList.add('hidden');
        }
        if (this.aiDebugPanel) {
            this.aiDebugPanel.classList.add('hidden');
        }
        if (this.scaleToggle) {
            this.scaleToggle.textContent = 'Scale: On';
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
        this.playerPrevMoved = false;
        this.gameTicks = 0;
        this.enemiesDestroyed = 0;
        this.gameOverStarted = false;
        this.rlEnemyData.clear();
        this.rlEnemyIdCounter = 0;
        
        await this.loadInitialMap();
        await this.loadTankDefinitions();
        if (this.fx) {
            await this.fx.preloadFx('move');
        }
        
        // Create player tank
        const spawnPosition = this.getSpawnPositionForTank('normal_pl', TILE_TYPES.PLAYER_SPAWN);
        this.player = this.createTankFromDefinition('normal_pl', spawnPosition.x, spawnPosition.y, '#4CAF50');
        this.shootCooldownTicksMax = this.player && typeof this.player.cooldown === 'number'
            ? this.player.cooldown
            : 0;
        this.playerRespawnsRemaining = 1;
        this.initRl();
        
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
            this.playerHQ = this.mapData ? this.mapData.getPlayerHQ() : null;
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
        const response = await fetch(`${tankRoot}/tanks.json`, { cache: 'no-store' });
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
            const processed = img ? createAlphaMaskedImage(img, 12) : null;
            const hitPoint = typeof def.tank_hit_point === 'number'
                ? def.tank_hit_point
                : Number(def.tank_hit_point);
            const cooldown = typeof def.cooldown === 'number'
                ? def.cooldown
                : Number(def.cooldown);
            this.tankDefinitions[def.tank_label] = {
                ...def,
                tank_hit_point: Number.isFinite(hitPoint) ? hitPoint : 1,
                cooldown: Number.isFinite(cooldown) ? cooldown : 0,
                textureImage: processed || img
            };
        });
    }

    initRl() {
        const config = window.RL_CONFIG || {};
        this.rlEnabled = !!(config.enabled && window.DeepRL && window.DeepRL.DqnAgentController);
        if (!this.rlEnabled) return;
        if (typeof config.baseModelStorageKey === 'string' && config.baseModelStorageKey) {
            const mapKey = this.getRlModelKey(config.initialMap || config.mapKeyOverride);
            if (mapKey) {
                config.modelStorageKey = `${config.baseModelStorageKey}-${mapKey}`;
            }
        }
        if (!this.rlAgent) {
            this.rlAgent = new window.DeepRL.DqnAgentController(config);
        }
        if (typeof this.rlAgent.resetEpisode === 'function') {
            this.rlAgent.resetEpisode();
        }
    }

    getRlModelKey(mapPath) {
        if (!mapPath) return null;
        const normalized = this.normalizeMapPath(mapPath);
        const clean = normalized.replace(/^maps\//i, '').replace(/\.json$/i, '');
        return clean.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    }

    createTankFromDefinition(label, x, y, fallbackColor) {
        const def = this.tankDefinitions ? this.tankDefinitions[label] : null;
        const tileSize = this.mapData ? this.mapData.tileSize : null;
        if (!def) {
            return new Tank(x, y, { color: fallbackColor, tileSize });
        }
        const hitPoint = typeof def.tank_hit_point === 'number'
            ? def.tank_hit_point
            : Number(def.tank_hit_point);
        const hp = Number.isFinite(hitPoint) ? hitPoint : 1;
        return new Tank(x, y, {
            color: fallbackColor,
            textureImage: def.textureImage,
            boundMin: def.bound_min || null,
            boundMax: def.bound_max || null,
            speed: def.speed,
            shellSize: def.shell_size,
            shellSpeed: def.shell_speed,
            shellColor: def.shell_color,
            health: hp,
            maxHealth: hp,
            cooldown: def.cooldown,
            tileSize
        });
    }

    tryRespawnPlayer() {
        if (this.playerRespawnsRemaining <= 0) return false;
        this.playerRespawnsRemaining -= 1;
        const spawnPosition = this.getSpawnPositionForTank('normal_pl', TILE_TYPES.PLAYER_SPAWN);
        this.player = this.createTankFromDefinition('normal_pl', spawnPosition.x, spawnPosition.y, '#4CAF50');
        this.shootCooldownTicksMax = this.player && typeof this.player.cooldown === 'number'
            ? this.player.cooldown
            : 0;
        this.shootCooldownTicks = 0;
        this.playerPrevMoved = false;
        this.playerContactDamageAccumulator = 0;
        this.updateUI();
        return true;
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
                this.tileImages[tileId] = createAlphaMaskedImage(img, 12);
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

    ensureRlInitialized(enemy) {
        if (!this.rlEnabled || !this.rlAgent) return;
        if (this.rlAgent.isInitialized) return;
        if (!window.DeepRL || typeof window.DeepRL.buildState !== 'function') return;
        const bounds = this.getMapBounds();
        const data = this.ensureRlEnemyData(enemy);
        const state = window.DeepRL.buildState({
            enemy,
            player: this.player,
            mapData: this.mapData,
            hqTile: this.playerHQ,
            bounds,
            idleTicks: data.idleTicks,
            aiTypeIndex: data.aiTypeIndex,
            config: window.RL_CONFIG
        });
        const actionCount = Array.isArray(window.RL_CONFIG.actionMap)
            ? window.RL_CONFIG.actionMap.length
            : 1;
        this.rlAgent.init(state.length, actionCount);
    }

    ensureRlEnemyData(enemy) {
        if (!enemy || !this.rlEnabled) return null;
        if (!enemy.aiId) {
            this.rlEnemyIdCounter += 1;
            enemy.aiId = `ai_${this.rlEnemyIdCounter}`;
        }
        let data = this.rlEnemyData.get(enemy.aiId);
        if (data) return data;
        const bounds = this.getMapBounds();
        const mapSize = bounds.width || 1;
        const dx = this.player ? this.player.x - enemy.x : 0;
        const dy = this.player ? this.player.y - enemy.y : 0;
        const playerDist = Math.sqrt(dx * dx + dy * dy);
        let hqDist = 0;
        if (this.mapData && this.playerHQ) {
            const hqPos = this.mapData.tileToPixel(this.playerHQ.col, this.playerHQ.row);
            const hqX = hqPos.x + this.mapData.tileSize / 2;
            const hqY = hqPos.y + this.mapData.tileSize / 2;
            const hqDx = hqX - enemy.x;
            const hqDy = hqY - enemy.y;
            hqDist = Math.sqrt(hqDx * hqDx + hqDy * hqDy);
        }
        const labelList = Array.isArray(window.RL_CONFIG.aiTankLabels)
            ? window.RL_CONFIG.aiTankLabels
            : [];
        const aiTypeIndex = labelList.length ? Math.max(0, labelList.indexOf(enemy.aiTankLabel)) : 0;
        data = {
            id: enemy.aiId,
            prevDistPlayer: playerDist || mapSize,
            prevDistHQ: hqDist || mapSize,
            pendingReward: 0,
            pendingDone: false,
            eventReward: 0,
            idleTicks: 0,
            prevDirX: enemy.dirX || 0,
            prevDirY: enemy.dirY || 0,
            ticksSinceDirChange: 0,
            aiTypeIndex
        };
        this.rlEnemyData.set(enemy.aiId, data);
        return data;
    }

    updateEnemyWithRl(enemy, bounds) {
        if (!this.rlEnabled || !this.rlAgent || !window.DeepRL) return false;
        const data = this.ensureRlEnemyData(enemy);
        if (!data) return false;
        if (typeof this.rlAgent.setDebugStep === 'function') {
            this.rlAgent.setDebugStep({
                buildState: false,
                sentObserve: false,
                workerAction: false,
                returnedAction: false
            });
        }
        this.ensureRlInitialized(enemy);
        const state = window.DeepRL.buildState({
            enemy,
            player: this.player,
            mapData: this.mapData,
            hqTile: this.playerHQ,
            bounds,
            idleTicks: data.idleTicks,
            aiTypeIndex: data.aiTypeIndex,
            config: window.RL_CONFIG
        });
        if (typeof this.rlAgent.setDebugStep === 'function') {
            this.rlAgent.setDebugStep({ buildState: true });
        }
        const reward = data.pendingReward || 0;
        const done = data.pendingDone || false;
        data.pendingReward = 0;
        data.pendingDone = false;
        data.eventReward = 0;
        this.rlAgent.observe({ id: data.id, state, reward, done });
        if (typeof this.rlAgent.setDebugStep === 'function') {
            this.rlAgent.setDebugStep({ sentObserve: true });
        }
        const config = window.RL_CONFIG || {};
        const nowMs = Date.now();
        const actionInfo = this.rlAgent.getActionInfo ? this.rlAgent.getActionInfo(data.id) : null;
        const responseTimeoutMs = typeof config.actionResponseTimeoutMs === 'number'
            ? config.actionResponseTimeoutMs
            : 0;
        let actionIndex = actionInfo ? actionInfo.action : 0;
        if (typeof this.rlAgent.setDebugStep === 'function') {
            this.rlAgent.setDebugStep({
                workerAction: !!actionInfo,
                returnedAction: !!actionInfo
            });
        }
        if (!actionInfo || (responseTimeoutMs && nowMs - actionInfo.time > responseTimeoutMs)) {
            actionIndex = window.DeepRL.pickRandomActionIndex(config, { mode: 'any' });
        }
        if (typeof config.stuckActionThreshold === 'number' && data.idleTicks >= config.stuckActionThreshold) {
            const mode = config.stuckActionMode === 'move' ? 'move' : 'any';
            actionIndex = window.DeepRL.pickRandomActionIndex(config, { mode });
        }
        const action = window.DeepRL.mapActionToControlEvents(actionIndex, window.RL_CONFIG);
        if (!enemy.aiShootCooldownMax) {
            enemy.aiShootCooldownMax = typeof enemy.cooldown === 'number' ? enemy.cooldown : 0;
        }
        if (typeof enemy.aiShootCooldownTicks !== 'number') {
            enemy.aiShootCooldownTicks = 0;
        }
        if (enemy.aiShootCooldownTicks > 0) {
            enemy.aiShootCooldownTicks -= 1;
        }
        const didMove = enemy.update(
            action.events,
            bounds,
            (x, y) => this.canTankOccupy(x, y, enemy),
            this.mapData
        );
        if (action.fire && enemy.aiShootCooldownTicks <= 0) {
            this.enemyShoot(enemy);
            enemy.aiShootCooldownTicks = enemy.aiShootCooldownMax;
        }
        data.idleTicks = didMove ? 0 : data.idleTicks + 1;
        const halfEnemyW = enemy.width >> 1;
        const halfEnemyH = enemy.height >> 1;
        enemy.x = Math.max(halfEnemyW, Math.min(enemy.x, bounds.width - halfEnemyW));
        enemy.y = Math.max(halfEnemyH, Math.min(enemy.y, bounds.height - halfEnemyH));
        return true;
    }

    addRlEventReward(enemy, reward) {
        if (!this.rlEnabled || !enemy) return;
        const data = this.ensureRlEnemyData(enemy);
        if (!data) return;
        data.eventReward += reward;
    }

    finalizeRlEpisode(extraRewardAll = 0) {
        if (!this.rlEnabled || !this.rlAgent || !window.DeepRL) return;
        const bounds = this.getMapBounds();
        this.enemies.forEach((enemy) => {
            const data = this.ensureRlEnemyData(enemy);
            if (!data) return;
            const state = window.DeepRL.buildState({
                enemy,
                player: this.player,
                mapData: this.mapData,
                hqTile: this.playerHQ,
                bounds,
                idleTicks: data.idleTicks,
                aiTypeIndex: data.aiTypeIndex,
                config: window.RL_CONFIG
            });
            const reward = (data.pendingReward || 0) + (data.eventReward || 0) + extraRewardAll;
            data.pendingReward = 0;
            data.eventReward = 0;
            data.pendingDone = false;
            this.rlAgent.observe({ id: data.id, state, reward, done: true });
        });
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
        const tileSize = this.mapData.tileSize;
        let colStart = Math.floor(boundRect.x / tileSize);
        let colEnd = Math.floor((boundRect.x + boundRect.w - 1) / tileSize);
        let rowStart = Math.floor(boundRect.y / tileSize);
        let rowEnd = Math.floor((boundRect.y + boundRect.h - 1) / tileSize);

        const tilesPerSide = this.mapData.tilesPerSide;
        colStart = Math.max(0, colStart);
        rowStart = Math.max(0, rowStart);
        colEnd = Math.min(tilesPerSide - 1, colEnd);
        rowEnd = Math.min(tilesPerSide - 1, rowEnd);

        if (colStart > colEnd || rowStart > rowEnd) {
            return false;
        }

        let tilesClear = true;
        for (let row = rowStart; row <= rowEnd; row += 1) {
            for (let col = colStart; col <= colEnd; col += 1) {
                if (!this.mapData.isAccessible(row, col)) {
                    tilesClear = false;
                    break;
                }
            }
            if (!tilesClear) break;
        }
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

    toggleAIDebug() {
        this.showAIDebug = !this.showAIDebug;
        const debugAiToggle = document.getElementById('debug-ai-toggle');
        if (debugAiToggle) {
            debugAiToggle.textContent = this.showAIDebug ? 'DebugAI: On' : 'DebugAI: Off';
        }
        if (this.aiDebugPanel) {
            this.aiDebugPanel.classList.toggle('hidden', !this.showAIDebug);
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

    updateAIDebugPanel() {
        if (!this.showAIDebug || !this.aiDebugPanel || !this.rlAgent) return;
        const info = this.rlAgent.getDebugInfo ? this.rlAgent.getDebugInfo() : null;
        if (!info) return;
        if (this.aiDebugState) this.aiDebugState.textContent = `State: ${info.state}`;
        if (this.aiDebugAction) this.aiDebugAction.textContent = `Action: ${info.action}`;
        if (this.aiDebugReward) this.aiDebugReward.textContent = `Reward: ${info.reward}`;
        if (this.aiDebugEpsilon) this.aiDebugEpsilon.textContent = `Epsilon: ${info.epsilon}`;
        if (this.aiDebugLoss) this.aiDebugLoss.textContent = `Loss: ${info.loss}`;
        if (this.aiDebugSteps) this.aiDebugSteps.textContent = `Steps: ${info.steps}`;
        if (this.aiDebugEpisodes) this.aiDebugEpisodes.textContent = `Episodes: ${info.episodes}`;
        if (this.aiDebugBuildState) this.aiDebugBuildState.textContent = `Build state: ${info.buildState ? 'true' : 'false'}`;
        if (this.aiDebugSentObserve) this.aiDebugSentObserve.textContent = `Sent observe: ${info.sentObserve ? 'true' : 'false'}`;
        if (this.aiDebugWorkerAction) this.aiDebugWorkerAction.textContent = `Worker action: ${info.workerAction ? 'true' : 'false'}`;
        if (this.aiDebugReturnedAction) this.aiDebugReturnedAction.textContent = `Action returned: ${info.returnedAction ? 'true' : 'false'}`;
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
        if (this.state === 'gameOver') return;
        
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
        if (this.state === 'ending') {
            this.updateEnding();
            return;
        }
        if (this.state !== 'playing') return;
        if (this.fx) {
            this.fx.updateGlobal();
        }
        this.gameTicks += 1;
        
        const bounds = this.getMapBounds();
        const controlEvents = this.input.getControlEvents();
        
        // Update player
        if (this.player && this.player.isAlive()) {
            const didMove = this.player.update(
                controlEvents,
                bounds,
                (x, y) => this.canTankOccupy(x, y, this.player),
                this.mapData
            );
            const halfPlayerW = this.player.width >> 1;
            const halfPlayerH = this.player.height >> 1;
            this.player.x = Math.max(halfPlayerW, Math.min(this.player.x, bounds.width - halfPlayerW));
            this.player.y = Math.max(halfPlayerH, Math.min(this.player.y, bounds.height - halfPlayerH));
            
            if (this.fx) {
                if (!this.playerPrevMoved && didMove) {
                    this.player.addFx('move', this.fx, this.player.x, this.player.y);
                } else if (this.playerPrevMoved && !didMove) {
                    this.player.stopFx('move');
                }
                this.playerPrevMoved = didMove;
            }

            // Shooting
            if (this.shootCooldownTicks > 0) {
                this.shootCooldownTicks -= 1;
            }
            if (controlEvents.includes('fire') && this.shootCooldownTicks <= 0) {
                this.shoot();
                this.shootCooldownTicks = this.shootCooldownTicksMax;
            }
            this.player.updateFx(this.fx);
        } else {
            // Player died
            if (!this.tryRespawnPlayer()) {
                this.finalizeRlEpisode(0);
                this.beginGameOver();
                return;
            }
        }
        
        // Update bullets
        this.bullets.forEach((bullet) => {
            bullet.update(bounds, this.mapData);
            if (!bullet.active && bullet.blockedByNonDestructible && bullet.owner && bullet.owner.aiId) {
                const weight = window.RL_CONFIG && window.RL_CONFIG.rewardWeights
                    ? window.RL_CONFIG.rewardWeights.nonDestructiveShotPenalty
                    : 0;
                if (weight) {
                    this.addRlEventReward(bullet.owner, weight);
                }
            }
        });
        this.bullets = this.bullets.filter(bullet => bullet.active);
        
        // HQ destroyed check
        if (this.playerHQ && this.mapData) {
            const hqTile = this.mapData.getTile(this.playerHQ.row, this.playerHQ.col);
            if (hqTile !== TILE_TYPES.PLAYER_HQ) {
                const reward = window.RL_CONFIG && window.RL_CONFIG.rewardWeights
                    ? window.RL_CONFIG.rewardWeights.destroyHQ
                    : 0;
                this.finalizeRlEpisode(reward);
                this.beginGameOver();
                return;
            }
        }
        
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
                const usedRl = this.updateEnemyWithRl(enemy, bounds);
                if (!usedRl) {
                    // Fallback: simple AI movement toward player
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
            }
            enemy.updateFx(this.fx);
        });
        
        // Collision detection: bullets vs enemies
        this.bullets.forEach(bullet => {
            if (!bullet.active) return;
            
            this.enemies.forEach(enemy => {
                if (bullet.checkCollision(enemy) && bullet.owner !== enemy) {
                    if (this.fx) {
                        const hitPos = this.getBulletHitPoint(bullet, enemy);
                        enemy.addFx('hit_tank', this.fx, hitPos.x, hitPos.y);
                    }
                    enemy.takeDamage(1);
                    if (window.RL_CONFIG && window.RL_CONFIG.rewardWeights) {
                        this.addRlEventReward(enemy, window.RL_CONFIG.rewardWeights.gotHit || 0);
                    }
                    this.logHit('enemy', enemy);
                    bullet.active = false;
                    
                    if (!enemy.isAlive()) {
                        if (this.fx) {
                            const center = this.getTankBoundCenter(enemy);
                            this.fx.playFx('destroy_tank', center.x, center.y);
                        }
                        if (window.RL_CONFIG && window.RL_CONFIG.rewardWeights) {
                            this.addRlEventReward(enemy, window.RL_CONFIG.rewardWeights.death || 0);
                        }
                        this.enemiesDestroyed += 1;
                        this.score += 100;
                        this.updateUI();
                    }
                }
            });
        });
        
        // Collision detection: bullets vs player
        this.bullets.forEach(bullet => {
            if (!bullet.active || !this.player || !this.player.isAlive()) return;
            if (bullet.owner === this.player) return;
            if (bullet.checkCollision(this.player)) {
                if (this.fx) {
                    const hitPos = this.getBulletHitPoint(bullet, this.player);
                    this.player.addFx('hit_tank', this.fx, hitPos.x, hitPos.y);
                }
                this.player.takeDamage(1);
                if (window.RL_CONFIG && window.RL_CONFIG.rewardWeights && bullet.owner) {
                    this.addRlEventReward(bullet.owner, window.RL_CONFIG.rewardWeights.hitPlayer || 0);
                }
                this.logHit('player', this.player);
                this.updateUI();
                if (!this.player.isAlive() && this.fx) {
                    const center = this.getTankBoundCenter(this.player);
                    this.player.stopAllFx();
                    this.fx.playFx('destroy_tank', center.x, center.y);
                }
                bullet.active = false;
            }
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

        // Deep RL: dense rewards and terminal transitions
        if (this.rlEnabled && this.rlAgent && window.DeepRL && typeof window.DeepRL.computeStepReward === 'function') {
            const boundsForRl = this.getMapBounds();
            const deadEnemies = [];
            this.enemies.forEach((enemy) => {
                const data = this.ensureRlEnemyData(enemy);
                if (!data) return;
                const directionChanged = enemy.dirX !== data.prevDirX || enemy.dirY !== data.prevDirY;
                const result = window.DeepRL.computeStepReward({
                    enemy,
                    player: this.player,
                    mapData: this.mapData,
                    hqTile: this.playerHQ,
                    prevDistPlayer: data.prevDistPlayer,
                    prevDistHQ: data.prevDistHQ,
                    idleTicks: data.idleTicks,
                    directionChanged,
                    ticksSinceDirChange: data.ticksSinceDirChange || 0,
                    bounds: boundsForRl,
                    config: window.RL_CONFIG
                });
                const stepReward = result && typeof result.reward === 'number' ? result.reward : 0;
                const eventReward = data.eventReward || 0;
                data.pendingReward = (data.pendingReward || 0) + stepReward + eventReward;
                data.eventReward = 0;
                if (result) {
                    if (typeof result.playerDist === 'number') data.prevDistPlayer = result.playerDist;
                    if (typeof result.hqDist === 'number') data.prevDistHQ = result.hqDist;
                }
                if (directionChanged) {
                    data.ticksSinceDirChange = 0;
                } else {
                    data.ticksSinceDirChange = (data.ticksSinceDirChange || 0) + 1;
                }
                data.prevDirX = enemy.dirX;
                data.prevDirY = enemy.dirY;
                if (!enemy.isAlive()) {
                    deadEnemies.push({ enemy, data });
                }
            });
            deadEnemies.forEach(({ enemy, data }) => {
                const terminalState = window.DeepRL.buildState({
                    enemy,
                    player: this.player,
                    mapData: this.mapData,
                    hqTile: this.playerHQ,
                    bounds: boundsForRl,
                    idleTicks: data.idleTicks,
                    aiTypeIndex: data.aiTypeIndex,
                    config: window.RL_CONFIG
                });
                this.rlAgent.observe({
                    id: data.id,
                    state: terminalState,
                    reward: data.pendingReward || 0,
                    done: true
                });
                this.rlEnemyData.delete(enemy.aiId);
            });
        }

        this.updateAIDebugPanel();
        
        // Remove dead enemies
        this.enemies = this.enemies.filter(enemy => enemy.isAlive());

        // FX updates handled by FxManager
    }

    beginGameOver() {
        if (this.gameOverStarted) return;
        this.gameOverStarted = true;
        this.state = 'ending';
        this.enemies.forEach((enemy) => {
            if (enemy && typeof enemy.stopAllFx === 'function') {
                enemy.stopAllFx();
            }
            if (enemy) {
                enemy.speed = 0;
            }
        });
        if (this.fx) {
            let fxX = 0;
            let fxY = 0;
            if (this.mapData && this.playerHQ) {
                const hqPos = this.mapData.tileToPixel(this.playerHQ.col, this.playerHQ.row);
                fxX = hqPos.x + (this.mapData.tileSize >> 1);
                fxY = hqPos.y + (this.mapData.tileSize >> 1);
            } else {
                const bounds = this.getMapBounds();
                fxX = bounds.width >> 1;
                fxY = bounds.height >> 1;
            }
            this.fx.playFx(this.gameOverFxName, fxX, fxY);
        } else {
            this.gameOver();
        }
    }

    updateEnding() {
        if (this.fx) {
            this.fx.updateGlobal();
            if (this.fx.hasActiveFx(this.gameOverFxName)) {
                return;
            }
        }
        this.gameOver();
    }
    
    shoot() {
        if (!this.player || !this.player.isAlive()) return;
        if (this.fx) {
            this.player.addFx('fire', this.fx, this.player.x, this.player.y);
        }
        
        const shellRadius = typeof this.player.shellSize === 'number' ? this.player.shellSize : 5;
        const boundRect = this.player.getBoundRect();
        const bulletX = boundRect ? (boundRect.x + (boundRect.w >> 1)) : this.player.x;
        const bulletY = boundRect ? (boundRect.y + (boundRect.h >> 1)) : this.player.y;
        
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
        const config = window.RL_CONFIG || {};
        const maxAlive = typeof config.maxEnemiesAlive === 'number' ? config.maxEnemiesAlive : 1;
        if (this.maxEnemyCount <= 0 || this.enemies.length >= this.maxEnemyCount) return;
        if (this.enemies.length >= maxAlive) return;
        const spawns = this.mapData.getSpawnPoints(TILE_TYPES.AI_SPAWN);
        if (spawns.length === 0) return;
        const labelList = Array.isArray(window.RL_CONFIG && window.RL_CONFIG.aiTankLabels)
            ? window.RL_CONFIG.aiTankLabels
            : ['normal_en'];
        const tankLabel = labelList[this.getRandomInt(labelList.length)] || 'normal_en';
        const spawnIndex = this.getRandomInt(spawns.length);
        const spawnPosition = this.getSpawnPositionForTank(tankLabel, TILE_TYPES.AI_SPAWN, spawns[spawnIndex]);
        if (this.showDebugBounds) {
            const def = this.tankDefinitions ? this.tankDefinitions[tankLabel] : null;
            const defHp = def ? def.tank_hit_point : null;
            this.appendSpawnDebugLine(
                `ai def hp: value=${defHp} type=${typeof defHp} hasDefs=${!!this.tankDefinitions}`
            );
        }
        const enemy = this.createTankFromDefinition(tankLabel, spawnPosition.x, spawnPosition.y, '#F44336');
        enemy.aiTankLabel = tankLabel;
        enemy.aiShootCooldownMax = typeof enemy.cooldown === 'number' ? enemy.cooldown : 0;
        enemy.aiShootCooldownTicks = 0;
        if (this.showDebugBounds) {
            const initInfo = {
                label: tankLabel,
                x: enemy.x,
                y: enemy.y,
                health: enemy.health,
                maxHealth: enemy.maxHealth,
                speed: enemy.speed,
                shellSize: enemy.shellSize,
                shellSpeed: enemy.shellSpeed,
                shellColor: enemy.shellColor
            };
            this.appendSpawnDebugLine(`ai spawn init: ${JSON.stringify(initInfo)}`);
        }
        if (this.canTankOccupy(spawnPosition.x, spawnPosition.y, enemy)) {
            this.ensureRlEnemyData(enemy);
            this.ensureRlInitialized(enemy);
            this.enemies.push(enemy);
        }
    }

    enemyShoot(enemy) {
        if (!enemy || !enemy.isAlive()) return;
        if (this.fx) {
            enemy.addFx('fire', this.fx, enemy.x, enemy.y);
        }
        const shellRadius = typeof enemy.shellSize === 'number' ? enemy.shellSize : 5;
        const boundRect = enemy.getBoundRect();
        const bulletX = boundRect ? (boundRect.x + (boundRect.w >> 1)) : enemy.x;
        const bulletY = boundRect ? (boundRect.y + (boundRect.h >> 1)) : enemy.y;
        const bulletSpeed = typeof enemy.shellSpeed === 'number' ? enemy.shellSpeed : 10;
        const bullet = new Bullet(
            bulletX,
            bulletY,
            enemy.dirX,
            enemy.dirY,
            bulletSpeed,
            enemy,
            { radius: shellRadius, color: enemy.shellColor }
        );
        this.bullets.push(bullet);
    }

    getBulletHitPoint(bullet, tank) {
        const rect = tank.getBoundRect();
        if (!rect) {
            return { x: tank.x, y: tank.y };
        }
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const hitX = clamp(bullet.x, rect.x, rect.x + rect.w);
        const hitY = clamp(bullet.y, rect.y, rect.y + rect.h);
        return { x: hitX, y: hitY };
    }

    getTankBoundCenter(tank) {
        const rect = tank.getBoundRect();
        if (!rect) {
            return { x: tank.x, y: tank.y };
        }
        return {
            x: rect.x + (rect.w >> 1),
            y: rect.y + (rect.h >> 1)
        };
    }

    logHit(targetLabel, target) {
        if (!this.showDebugBounds) return;
        let message = `hit: ${targetLabel}`;
        if (target && typeof target.health === 'number') {
            const maxHp = typeof target.maxHealth === 'number' ? target.maxHealth : target.health;
            message += ` hp=${target.health}/${maxHp}`;
        }
        this.appendSpawnDebugLine(message);
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

            if (this.fx) {
                if (this.player) {
                    this.player.drawFx(this.fx);
                }
                this.enemies.forEach(enemy => enemy.drawFx(this.fx));
            }
        }
        this.drawGrassOverlay();
        this.drawBlockingTileBounds();
        if (this.fx) {
            this.fx.drawGlobal();
        }
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
        const totalMs = this.gameTicks * this.fixedTimeStepMs;
        const totalSeconds = Math.floor(totalMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeLabel = `${minutes}:${String(seconds).padStart(2, '0')}`;
        document.getElementById('final-score').textContent = `Final Score: ${this.score}`;
        document.getElementById('final-time').textContent = `Time: ${timeLabel}`;
        document.getElementById('final-destroyed').textContent = `Destroyed: ${this.enemiesDestroyed}`;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    window.__game = game;
    window.RenderFx = (name, x, y) => {
        if (!window.__game) return;
        if (!window.__game.fx) return;
        window.__game.fx.playFx(name, x, y);
    };
});
