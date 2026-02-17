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
        this.fullscreenToggle = document.getElementById('fullscreen-toggle');
        this.debugToggle = document.getElementById('debug-toggle');
        this.sessionIdLabel = document.getElementById('session-id-label');
        this.copySessionIdButton = document.getElementById('copy-session-id-button');
        this.debugPanel = document.getElementById('debug-panel');
        this.debugFps = document.getElementById('debug-fps');
        this.playerTilePos = document.getElementById('player-tile-pos');
        this.spawnDebugLog = document.getElementById('spawn-debug-log');
        this.debugPerformanceEl = document.getElementById('debug-performance');
        this.aiDebugPanel = document.getElementById('ai-debug-panel');
        this.gbeDebugPanel = document.getElementById('gbe-debug-panel');
        this.gbeDebugLog = document.getElementById('gbe-debug-log');
        this.gbeDebugMeta = document.getElementById('gbe-debug-meta');
        this.gbeDebugPerformance = document.getElementById('gbe-debug-performance');
        this.gbePlayerIds = document.getElementById('gbe-player-ids');
        this.gbeAiIds = document.getElementById('gbe-ai-ids');
        this.aiDebugState = document.getElementById('ai-debug-state');
        this.aiDebugAction = document.getElementById('ai-debug-action');
        this.aiDebugReward = document.getElementById('ai-debug-reward');
        this.aiDebugRewardReasons = document.getElementById('ai-debug-reward-reasons');
        this.aiDebugEpsilon = document.getElementById('ai-debug-epsilon');
        this.aiDebugTdLoss = document.getElementById('ai-debug-td-loss');
        this.aiDebugQMean = document.getElementById('ai-debug-q-mean');
        this.aiDebugSteps = document.getElementById('ai-debug-steps');
        this.aiDebugEpisodes = document.getElementById('ai-debug-episodes');
        this.aiDebugActionsStats = document.getElementById('ai-debug-actions-stats');
        this.aiDebugModelPool = document.getElementById('ai-debug-model-pool');
        this.aiDebugBuildState = document.getElementById('ai-debug-build-state');
        this.aiDebugSentObserve = document.getElementById('ai-debug-sent-observe');
        this.aiDebugWorkerAction = document.getElementById('ai-debug-worker-action');
        this.aiDebugReturnedAction = document.getElementById('ai-debug-returned-action');
        this.aiDebugInputCount = document.getElementById('ai-debug-input-count');
        this.aiDebugError = document.getElementById('ai-debug-error');
        this.aiDebugConnLog = document.getElementById('ai-debug-conn-log');
        this.aiDebugTrainStats = document.getElementById('ai-debug-train-stats');
        this.aiDebugPerformance = document.getElementById('ai-debug-performance');
        this.aiDebugInference = document.getElementById('ai-debug-inference');
        this.aiDebugModelInstances = document.getElementById('ai-debug-model-instances');
        this.aiDebugMoveLog = document.getElementById('ai-debug-move-log');
        this.aiEpisodeLogs = [];
        this.autoScale = true;
        this.showDebugBounds = false;
        this.showAIDebug = false;
        this.showGBEDebug = false;
        this.spawnDebugLines = [];
        this.gbeDebugLines = [];
        this.gbeLastEventKey = null;
        this.clientFps = 0;
        this.clientFpsFrames = 0;
        this.clientFpsLastMs = 0;
        this.backendFps = 0;
        this.backendFpsLastTick = null;
        this.backendFpsLastMs = 0;
        this.initialPlayerSpawnRect = null;
        this.mapPixelSize = 0;
        this.tileImages = {};
        this.aiSpawnIndex = 0;
        this.tankDefinitions = null;
        this.maxEnemyCount = 0;
        this.randomSeed = (Date.now() | 0) ^ 0x9e3779b9;
        this.fx = new FxManager(this.ctx, { fixedTimeStepMs: this.fixedTimeStepMs });
        this.playerHQ = null;
        this.gameOverStarted = false;
        this.gameOverFxName = 'destroy_hq';
        this.networkClient = null;
        this.networkMode = false;
        this.networkState = null;
        this.networkPlayerId = null;
        this.currentSessionId = null;
        this.netStats = {
            totalRecv: 0,
            totalSent: 0,
            tickRecv: 0,
            tickSent: 0,
            breakdown: null
        };
        this.lastNetLogTick = 0;
        this.networkTanks = new Map();
        this.networkPrevPositions = new Map();
        this.backendAIDebug = null;
        this.backendGBEDebug = null;
        this.aiDebugLabels = null;
        this.gbeDebugLabels = null;
        this.networkPlayerStateLabels = null;
        this.networkBulletStateLabels = null;
        
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
        this.mapBaseCanvas = null;
        this.mapGrassCanvas = null;
        this.isMobile = typeof window !== 'undefined' && (window.innerWidth <= 768 || !!('ontouchstart' in window));
        this.lastMobileUpdateMs = 0;
        this.perfTimings = { inputMs: 0, networkMs: 0, updateMs: 0, fxUpdateMs: 0, renderMs: 0, rebuildFullMap: false };
        
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
        this.autoRestartEnabled = false;
        this.autoRestartSeconds = 5;
        this.autoRestartRemaining = 0;
        this.autoRestartTimer = null;
        this.autoRestartToggle = null;
        this.autoRestartCountdown = null;
        
        this.setupUI();
        this.init();
    }
    
    setupUI() {
        const startButton = document.getElementById('start-button');
        const restartButton = document.getElementById('restart-button');
        const autoRestartToggle = document.getElementById('auto-restart-toggle');
        const autoRestartCountdown = document.getElementById('auto-restart-countdown');
        const joinButton = document.getElementById('join-button');
        const sessionInput = document.getElementById('session-id-input');
        const debugAiToggle = document.getElementById('debug-ai-toggle');
        const debugGbeToggle = document.getElementById('debug-gbe-toggle');

        this.autoRestartToggle = autoRestartToggle;
        this.autoRestartCountdown = autoRestartCountdown;
        
        startButton.addEventListener('click', () => this.startOnlineGame('create'));
        restartButton.addEventListener('click', () => this.restartGameFlow());
        if (joinButton) {
            joinButton.addEventListener('click', () => {
                const sessionId = sessionInput ? sessionInput.value.trim() : '';
                if (sessionId) {
                    this.startOnlineGame('join', sessionId);
                }
            });
        }
        if (autoRestartToggle) {
            autoRestartToggle.addEventListener('click', () => {
                this.setAutoRestartEnabled(!this.autoRestartEnabled);
                if (this.state === 'gameOver') {
                    this.startAutoRestartTimer();
                } else {
                    this.updateAutoRestartCountdown();
                }
            });
        }

        if (this.scaleToggle) {
            this.scaleToggle.addEventListener('click', () => this.toggleScale());
        }
        if (this.fullscreenToggle) {
            this.fullscreenToggle.addEventListener('click', () => this.toggleFullscreen());
        }
        const fullscreenChange = () => {
            this.updateFullscreenButtonLabel();
            if (!this.isFullscreen()) this.applyScale();
        };
        document.addEventListener('fullscreenchange', fullscreenChange);
        document.addEventListener('webkitfullscreenchange', fullscreenChange);
        document.addEventListener('mozfullscreenchange', fullscreenChange);
        document.addEventListener('MSFullscreenChange', fullscreenChange);
        if (this.debugToggle) {
            this.debugToggle.addEventListener('click', () => this.toggleDebugBounds());
        }
        if (debugAiToggle) {
            debugAiToggle.addEventListener('click', () => this.toggleAIDebug());
        }
        if (debugGbeToggle) {
            debugGbeToggle.addEventListener('click', () => this.toggleGBEDebug());
        }
        if (this.copySessionIdButton) {
            this.copySessionIdButton.addEventListener('click', async () => {
                const sessionId = this.currentSessionId || (this.networkClient ? this.networkClient.sessionId : null);
                if (!sessionId) return;
                try {
                    await navigator.clipboard.writeText(sessionId);
                    this.copySessionIdButton.textContent = 'Copied';
                    setTimeout(() => {
                        if (this.copySessionIdButton) {
                            this.copySessionIdButton.textContent = 'Copy';
                        }
                    }, 1200);
                } catch {
                    this.copySessionIdButton.textContent = 'Failed';
                    setTimeout(() => {
                        if (this.copySessionIdButton) {
                            this.copySessionIdButton.textContent = 'Copy';
                        }
                    }, 1200);
                }
            });
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
        if (this.gbeDebugPanel) {
            this.gbeDebugPanel.classList.add('hidden');
        }
        if (this.scaleToggle) {
            this.scaleToggle.textContent = 'Scale: On';
        }
        const debugGbeToggle = document.getElementById('debug-gbe-toggle');
        if (debugGbeToggle) {
            debugGbeToggle.textContent = 'DebugGBE: Off';
        }
        this.updateFullscreenButtonLabel();
        this.applyScale();
    }
    
    async startGame() {
        this.clearAutoRestartTimer();
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
        this.currentSessionId = null;
        
        await this.loadInitialMap();
        await this.loadTankDefinitions();
        if (this.fx) {
            await this.fx.preloadFx('move');
            this.fx.resumeAudioContext();
        }
        
        // Create player tank
        const spawnPosition = this.getSpawnPositionForTank('normal_pl', TILE_TYPES.PLAYER_SPAWN);
        this.player = this.createTankFromDefinition('normal_pl', spawnPosition.x, spawnPosition.y, '#4CAF50');
        if (this.player) {
            this.player.setDirection(0, -1);
        }
        this.shootCooldownTicksMax = this.player && typeof this.player.cooldown === 'number'
            ? this.player.cooldown
            : 0;
        this.playerRespawnsRemaining = 1;
        if (this.fx) {
            const bounds = this.getMapBounds();
            const fxX = bounds.width >> 1;
            const fxY = bounds.height >> 1;
            this.fx.playFx('game_start', fxX, fxY);
        }
        
        // Hide/show screens
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        
        this.updateUI();
        this.gameLoop(performance.now());
    }

    async startOnlineGame(mode, sessionId = '') {
        this.clearAutoRestartTimer();
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
        this.networkMode = true;
        this.networkState = null;
        this.networkPlayerId = null;
        this.currentSessionId = null;
        this.aiDebugLabels = null;
        this.gbeDebugLabels = null;
        this.networkPlayerStateLabels = null;
        this.networkBulletStateLabels = null;
        this.backendGBEDebug = null;
        this.netStats = {
            totalRecv: 0,
            totalSent: 0,
            tickRecv: 0,
            tickSent: 0,
            breakdown: null
        };
        this.lastNetLogTick = 0;

        const config = window.GAME_CONFIG || {};
        const backendUrl = config.backendUrl;
        const wsUrl = config.backendWsUrl;
        if (!backendUrl || !wsUrl) {
            window.alert('Missing backend runtime config. Check js/runtime-config.js and deploy profile settings.');
            this.state = 'menu';
            return;
        }
        this.networkClient = new NetworkClient({
            backendUrl,
            wsUrl,
            onState: (state, isDelta) => this.applyNetworkState(state, isDelta),
            onNetStats: (stats) => { this.netStats = stats; }
        });

        await this.loadTankDefinitions();
        if (this.fx) {
            await this.fx.preloadFx('move');
            this.fx.resumeAudioContext();
        }

        try {
            let payload;
            if (mode === 'join') {
                payload = await this.networkClient.joinSession(sessionId);
            } else {
                const gameConfig = window.GAME_CONFIG || {};
                const rlConfig = window.RL_CONFIG || {};
                const maxEnemiesAlive = (typeof rlConfig.maxEnemiesAlive === 'number')
                    ? rlConfig.maxEnemiesAlive
                    : gameConfig.maxEnemiesAlive;
                payload = await this.networkClient.createSession(
                    config.initialMap || 'Stage03.json',
                    { maxEnemiesAlive }
                );
            }
            await this.networkClient.connect('player');
            this.networkClient.setDebugAI(this.showAIDebug);
            this.networkClient.setDebugGBE(this.showGBEDebug);
            this.networkPlayerId = payload.playerId;
            this.currentSessionId = payload.sessionId || this.networkClient.sessionId || null;
            if (payload.map) {
                this.mapData = new MapData(payload.map);
                this.mapBaseCanvas = null;
                this.mapGrassCanvas = null;
                this.mapPixelSize = this.mapData.mapSize;
                this.canvas.width = this.mapData.mapSize;
                this.canvas.height = this.mapData.mapSize;
                this.playerHQ = this.mapData.getPlayerHQ();
                await this.loadTileImages();
                this.applyScale();
            }
            if (payload.state) {
                this.applyNetworkState(payload.state, false);
            }
        } catch (error) {
            window.alert(error.message || 'Failed to start online game.');
            this.state = 'menu';
            return;
        }

        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        this.updateUI();
        this.gameLoop(performance.now());
    }

    restartGameFlow() {
        if (this.networkMode) {
            this.startOnlineGame('create');
        } else {
            this.startGame();
        }
    }

    setAutoRestartEnabled(enabled) {
        this.autoRestartEnabled = Boolean(enabled);
        this.updateAutoRestartToggleUI();
    }

    updateAutoRestartToggleUI() {
        if (this.autoRestartToggle) {
            this.autoRestartToggle.textContent = this.autoRestartEnabled
                ? 'Auto Play Again: On'
                : 'Auto Play Again: Off';
        }
    }

    updateAutoRestartCountdown() {
        if (!this.autoRestartCountdown) return;
        if (!this.autoRestartEnabled || this.autoRestartRemaining <= 0) {
            this.autoRestartCountdown.textContent = 'Next game in: --';
            return;
        }
        this.autoRestartCountdown.textContent = `Next game in: ${this.autoRestartRemaining}s`;
    }

    clearAutoRestartTimer() {
        if (this.autoRestartTimer) {
            clearInterval(this.autoRestartTimer);
            this.autoRestartTimer = null;
        }
        this.autoRestartRemaining = 0;
        this.updateAutoRestartCountdown();
    }

    startAutoRestartTimer() {
        this.clearAutoRestartTimer();
        if (!this.autoRestartEnabled) return;
        this.autoRestartRemaining = this.autoRestartSeconds;
        this.updateAutoRestartCountdown();
        this.autoRestartTimer = setInterval(() => {
            this.autoRestartRemaining -= 1;
            if (this.autoRestartRemaining <= 0) {
                this.clearAutoRestartTimer();
                this.restartGameFlow();
                return;
            }
            this.updateAutoRestartCountdown();
        }, 1000);
    }

    async loadInitialMap() {
        const config = window.GAME_CONFIG || {};
        const mapPath = this.normalizeMapPath(config.initialMap || 'maps/Stage01.json');
        
        try {
            this.mapData = await loadMap(mapPath);
            this.mapBaseCanvas = null;
            this.mapGrassCanvas = null;
            this.mapLoadError = null;
            if (this.mapData && this.mapData.mapSize) {
                this.mapPixelSize = this.mapData.mapSize;
                this.canvas.width = this.mapData.mapSize;
                this.canvas.height = this.mapData.mapSize;
            }
            this.playerHQ = this.mapData ? this.mapData.getPlayerHQ() : null;
            const spawnCount = this.mapData
                ? this.mapData.getSpawnPoints(TILE_TYPES.AI_SPAWN).length
                : 0;
            const cfgMax = window.GAME_CONFIG && typeof window.GAME_CONFIG.maxEnemiesAlive === 'number'
                ? window.GAME_CONFIG.maxEnemiesAlive
                : spawnCount;
            this.maxEnemyCount = Math.min(spawnCount, cfgMax);
            this.aiSpawnIndex = 0;
            await this.loadTileImages();
            this.applyScale();
        } catch (error) {
            this.mapData = null;
            this.mapBaseCanvas = null;
            this.mapGrassCanvas = null;
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

    isFullscreen() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );
    }

    isFullscreenFallback() {
        return document.body.classList.contains('fullscreen-fallback');
    }

    async toggleFullscreen() {
        if (this.isFullscreen()) {
            await this.exitFullscreen();
            return;
        }
        if (this.isFullscreenFallback()) {
            this.exitFullscreenFallback();
            return;
        }
        const doc = document.documentElement;
        const req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
        if (typeof req === 'function') {
            try {
                await req.call(doc);
            } catch {
                this.enterFullscreenFallback();
            }
        } else {
            this.enterFullscreenFallback();
        }
    }

    async exitFullscreen() {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (typeof exit === 'function') {
            try {
                await exit.call(document);
            } catch {}
        }
    }

    enterFullscreenFallback() {
        document.body.classList.add('fullscreen-fallback');
        this.updateFullscreenButtonLabel();
        this.applyScale();
    }

    exitFullscreenFallback() {
        document.body.classList.remove('fullscreen-fallback');
        this.updateFullscreenButtonLabel();
        this.applyScale();
    }

    updateFullscreenButtonLabel() {
        if (!this.fullscreenToggle) return;
        if (this.isFullscreen() || this.isFullscreenFallback()) {
            this.fullscreenToggle.textContent = 'Exit Fullscreen';
        } else {
            this.fullscreenToggle.textContent = 'Fullscreen';
        }
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
            if (this.debugFps) {
                this.debugFps.textContent = 'Client FPS: --';
            }
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
        if (this.networkMode && this.networkClient) {
            this.networkClient.setDebugAI(this.showAIDebug);
        }
    }

    toggleGBEDebug() {
        this.showGBEDebug = !this.showGBEDebug;
        const debugGbeToggle = document.getElementById('debug-gbe-toggle');
        if (debugGbeToggle) {
            debugGbeToggle.textContent = this.showGBEDebug ? 'DebugGBE: On' : 'DebugGBE: Off';
        }
        if (this.gbeDebugPanel) {
            this.gbeDebugPanel.classList.toggle('hidden', !this.showGBEDebug);
        }
        if (this.networkMode && this.networkClient) {
            this.networkClient.setDebugGBE(this.showGBEDebug);
        }
        if (!this.showGBEDebug) {
            this.gbeDebugLines = [];
            this.gbeLastEventKey = null;
            if (this.gbeDebugLog) {
                this.gbeDebugLog.textContent = '';
            }
            if (this.gbeDebugMeta) {
                this.gbeDebugMeta.textContent = 'GBE src: -- | Sessions: -- | AI inputs recv/applied: --/-- | sockets ai/client: --/-- | errCount: -- | Backend FPS: --';
            }
            if (this.gbeDebugPerformance) {
                this.gbeDebugPerformance.textContent = 'Performance: --';
            }
            if (this.gbePlayerIds) this.gbePlayerIds.textContent = '--';
            if (this.gbeAiIds) this.gbeAiIds.textContent = '--';
        }
    }

    formatPerfMs(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return '--';
        return value.toFixed(2);
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
        if (!this.showAIDebug || !this.aiDebugPanel) return;
        if (this.networkMode) {
            const info = this.backendAIDebug || {};
            const gbe = this.backendGBEDebug || {};
            const recvTotal = typeof gbe.recvTotal === 'number' ? gbe.recvTotal : 0;
            const appliedTotal = typeof gbe.appliedTotal === 'number' ? gbe.appliedTotal : 0;
            const last = gbe.lastApplied || gbe.lastReceived || null;
            if (this.aiDebugState) {
                const source = gbe.stateSource ? ` [${gbe.stateSource}]` : '';
                const stateText = info.state || 'backend-authoritative';
                this.aiDebugState.textContent = `State: ${stateText}${source}`;
            }
            const actionValue = info.action || (last ? (last.move || 'none') : '--');
            if (this.aiDebugAction) this.aiDebugAction.textContent = `Action: ${actionValue}`;
            if (this.aiDebugReward) this.aiDebugReward.textContent = `Reward: ${info.reward ?? '--'}`;
            if (this.aiDebugRewardReasons) {
                let reasons = '--';
                let branch = 'unset';
                if (Array.isArray(info.rewardReasons)) {
                    branch = info.rewardReasons.length ? 'array' : 'array-empty';
                    reasons = info.rewardReasons.length ? info.rewardReasons.join(', ') : 'none';
                } else if (info.rewardReasons) {
                    branch = 'value';
                    reasons = info.rewardReasons;
                } else {
                    branch = 'missing';
                }
                this.aiDebugRewardReasons.textContent = `Reward reasons: ${reasons} (src=${branch})`;
            }
            if (this.aiDebugEpsilon) this.aiDebugEpsilon.textContent = `Epsilon: ${info.epsilon ?? '--'}`;
            if (this.aiDebugTdLoss) {
                const tdLoss = typeof info.tdLoss === 'number' ? info.tdLoss.toFixed(4) : '--';
                this.aiDebugTdLoss.textContent = `TD Loss: ${tdLoss}`;
            }
            if (this.aiDebugQMean) {
                const qMean = typeof info.qMean === 'number' ? info.qMean.toFixed(4) : '--';
                this.aiDebugQMean.textContent = `Q mean: ${qMean}`;
            }
            if (this.aiDebugSteps) this.aiDebugSteps.textContent = `Steps: ${info.steps ?? this.gameTicks}`;
            if (this.aiDebugEpisodes) this.aiDebugEpisodes.textContent = `Episodes: ${info.episodes ?? '--'}`;
            if (this.aiDebugActionsStats) {
                const transitions = typeof info.transitionsReceived === 'number' ? info.transitionsReceived : '--';
                const actions = typeof info.actionsGenerated === 'number' ? info.actionsGenerated : '--';
                const gbeEvents = typeof info.gbeInputEvents === 'number' ? info.gbeInputEvents : '--';
                const actionTick = (typeof info.actionTick === 'number' || typeof info.actionTick === 'string')
                    ? info.actionTick
                    : '--';
                this.aiDebugActionsStats.textContent = `Transitions/actions/GBE events: ${transitions}/${actions}/${gbeEvents} | actionTick: ${actionTick}`;
            }
            if (this.aiDebugModelPool) {
                const available = typeof info.modelPoolAvailable === 'number' ? info.modelPoolAvailable : '--';
                const total = typeof info.modelPoolTotal === 'number' ? info.modelPoolTotal : '--';
                const inUse = typeof info.modelPoolInUse === 'number' ? info.modelPoolInUse : '--';
                this.aiDebugModelPool.textContent = `Model pool available/total/in-use: ${available}/${total}/${inUse}`;
            }
            if (this.aiDebugBuildState) this.aiDebugBuildState.textContent = `Build state: ${info.buildState ? 'true' : 'false'}`;
            if (this.aiDebugSentObserve) this.aiDebugSentObserve.textContent = `Sent observe: ${info.sentObserve ? 'true' : 'false'}`;
            if (this.aiDebugWorkerAction) this.aiDebugWorkerAction.textContent = `Worker action: ${info.workerAction ? 'true' : 'false'}`;
            if (this.aiDebugReturnedAction) this.aiDebugReturnedAction.textContent = `Action returned: ${info.returnedAction ? 'true' : 'false'}`;
            if (this.aiDebugInputCount) {
                this.aiDebugInputCount.textContent = `AI inputs recv/applied: ${recvTotal}/${appliedTotal}`;
            }
            if (this.aiDebugError) {
                const err = gbe.lastError || null;
                const errCount = typeof gbe.errorCount === 'number' ? gbe.errorCount : 0;
                if (!err) {
                    this.aiDebugError.textContent = `AI error: none (count=${errCount})`;
                } else {
                    this.aiDebugError.textContent = `AI error: [${err.step || '--'}] ${err.message || '--'} (tick=${err.tick || 0}, count=${errCount})`;
                }
            }
            if (this.aiDebugTrainStats) {
                const count = typeof info.rewardBatchCount === 'number' ? info.rewardBatchCount : '--';
                const sum = typeof info.rewardBatchSum === 'number' ? info.rewardBatchSum.toFixed(2) : '--';
                const steps = typeof info.trainStepsDelta === 'number' ? info.trainStepsDelta : '--';
                this.aiDebugTrainStats.textContent = `Rewards/train: count=${count} sum=${sum} steps=${steps}`;
            }
            if (this.aiDebugPerformance) {
                const trainMs = typeof info.perfTrainMs === 'number' ? info.perfTrainMs.toFixed(2) : '--';
                const inferMs = typeof info.perfInferMs === 'number' ? info.perfInferMs.toFixed(2) : '--';
                const saveMs = typeof info.asyncSaveMs === 'number' ? info.asyncSaveMs.toFixed(2) : '--';
                const modelKb = typeof info.memModelBytes === 'number'
                    ? (info.memModelBytes / 1024).toFixed(1)
                    : '--';
                const trainKb = typeof info.memTrainStateBytes === 'number'
                    ? (info.memTrainStateBytes / 1024).toFixed(1)
                    : '--';
                const historyKb = typeof info.memHistoryBytes === 'number'
                    ? (info.memHistoryBytes / 1024).toFixed(1)
                    : '--';
                this.aiDebugPerformance.textContent =
                    `Performance:\ntrain=${trainMs}ms infer=${inferMs}ms asyncSave=${saveMs}ms\n` +
                    `memory: model=${modelKb}KB train=${trainKb}KB history=${historyKb}KB`;
            }
            if (this.aiDebugInference) {
                const epCount = typeof info.inferenceEpisodeCount === 'number' ? info.inferenceEpisodeCount : '--';
                const avgReward = typeof info.inferenceAvgReward === 'number' ? info.inferenceAvgReward.toFixed(2) : '--';
                const avgSteps = typeof info.inferenceAvgSteps === 'number' ? info.inferenceAvgSteps.toFixed(1) : '--';
                const winRate = typeof info.inferenceWinRate === 'number' ? (info.inferenceWinRate * 100).toFixed(1) : '--';
                const hitRate = typeof info.inferenceHitRate === 'number' ? (info.inferenceHitRate * 100).toFixed(1) : '--';
                const hqRate = typeof info.inferenceHqRate === 'number' ? (info.inferenceHqRate * 100).toFixed(1) : '--';
                const dealt = typeof info.inferenceAvgDamageDealt === 'number' ? info.inferenceAvgDamageDealt.toFixed(2) : '--';
                const taken = typeof info.inferenceAvgDamageTaken === 'number' ? info.inferenceAvgDamageTaken.toFixed(2) : '--';
                const timeToWin = typeof info.inferenceAvgTimeToWin === 'number' ? info.inferenceAvgTimeToWin.toFixed(1) : '--';
                const ratio = (typeof info.inferenceAvgDamageDealt === 'number' && typeof info.inferenceAvgDamageTaken === 'number' && info.inferenceAvgDamageTaken > 0)
                    ? (info.inferenceAvgDamageDealt / info.inferenceAvgDamageTaken).toFixed(2)
                    : '--';
                this.aiDebugInference.textContent =
                    `Inference Measurement:\n` +
                    `episodes=${epCount} avgReward=${avgReward} avgSteps=${avgSteps} winRate=${winRate}% timeToWin=${timeToWin}\n` +
                    `hitRate=${hitRate}% hqRate=${hqRate}% damage=${dealt}/${taken} ratio=${ratio}`;
            }
            if (this.aiDebugModelInstances) {
                const instances = Array.isArray(info.modelInstancesBrief) ? info.modelInstancesBrief : [];
                if (!instances.length) {
                    this.aiDebugModelInstances.textContent = 'Model instances: --';
                } else {
                    const lines = instances.map((item) => {
                        const sessionId = item && item.sessionId ? String(item.sessionId).slice(0, 8) : '--';
                        const wsId = item && item.wsId ? String(item.wsId) : '--';
                        const state = item && item.state ? item.state : '--';
                        return `session=${sessionId} ws=${wsId} state=${state}`;
                    });
                    this.aiDebugModelInstances.textContent = `Model instances:\n${lines.join('\n')}`;
                }
            }
            if (this.aiDebugMoveLog) {
                const episodeLog = info.episodeLog;
                const episodeTick = info.episodeLogTick;
                if (episodeLog) {
                    const last = this.aiEpisodeLogs[this.aiEpisodeLogs.length - 1];
                    const entry = `tick ${episodeTick ?? '--'} - ${episodeLog}`;
                    if (entry !== last) {
                        this.aiEpisodeLogs.push(entry);
                        this.aiEpisodeLogs = this.aiEpisodeLogs.slice(-10);
                    }
                }
                const tick = typeof info.steps === 'number' ? info.steps : '--';
                const currentLine = info.receivedActions && info.receivedActions !== '--'
                    ? `tick ${tick} - ${info.receivedActions}`
                    : `tick ${tick} - --`;
                const lines = [currentLine, ...this.aiEpisodeLogs.slice(-5)];
                this.aiDebugMoveLog.textContent = lines.join('\n');
            }
            if (this.aiDebugConnLog) this.aiDebugConnLog.textContent = '';
            return;
        }
        if (this.aiDebugState) this.aiDebugState.textContent = 'State: local-mode (no client RL)';
        if (this.aiDebugAction) this.aiDebugAction.textContent = 'Action: --';
        if (this.aiDebugReward) this.aiDebugReward.textContent = 'Reward: --';
        if (this.aiDebugRewardReasons) this.aiDebugRewardReasons.textContent = 'Reward reasons: --';
        if (this.aiDebugEpsilon) this.aiDebugEpsilon.textContent = 'Epsilon: --';
        if (this.aiDebugTdLoss) this.aiDebugTdLoss.textContent = 'TD Loss: --';
        if (this.aiDebugQMean) this.aiDebugQMean.textContent = 'Q mean: --';
        if (this.aiDebugSteps) this.aiDebugSteps.textContent = `Steps: ${this.gameTicks}`;
        if (this.aiDebugEpisodes) this.aiDebugEpisodes.textContent = 'Episodes: --';
        if (this.aiDebugActionsStats) this.aiDebugActionsStats.textContent = 'Transitions/actions/GBE events: --/--/--';
        if (this.aiDebugModelPool) this.aiDebugModelPool.textContent = 'Model pool available/total/in-use: --/--/--';
        if (this.aiDebugBuildState) this.aiDebugBuildState.textContent = 'Build state: --';
        if (this.aiDebugSentObserve) this.aiDebugSentObserve.textContent = 'Sent observe: --';
        if (this.aiDebugWorkerAction) this.aiDebugWorkerAction.textContent = 'Worker action: --';
        if (this.aiDebugReturnedAction) this.aiDebugReturnedAction.textContent = 'Action returned: --';
        if (this.aiDebugInputCount) this.aiDebugInputCount.textContent = 'AI inputs recv/applied: --';
        if (this.aiDebugError) this.aiDebugError.textContent = 'AI error: --';
        if (this.aiDebugTrainStats) this.aiDebugTrainStats.textContent = 'Rewards/train: --';
        if (this.aiDebugPerformance) this.aiDebugPerformance.textContent = 'Performance: --';
        if (this.aiDebugInference) this.aiDebugInference.textContent = 'Inference Measurement: --';
        if (this.aiDebugModelInstances) this.aiDebugModelInstances.textContent = 'Model instances: --';
        if (this.aiDebugMoveLog) this.aiDebugMoveLog.textContent = 'tick -- - --';
        if (this.aiDebugConnLog) this.aiDebugConnLog.textContent = '';
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
        this.syncTouchHudPosition(titleBarHeight, scaledSize);
    }

    syncTouchHudPosition(titleBarHeight, canvasHeight) {
        const base = document.getElementById('touch-joystick-base');
        const fireBtn = document.getElementById('touch-fire-button');
        if (!base || !fireBtn) return;
        const inset = 48;
        base.style.left = `${inset}px`;
        base.style.bottom = `${inset}px`;
        base.style.top = 'auto';
        fireBtn.style.right = `${inset}px`;
        fireBtn.style.bottom = `${inset}px`;
        fireBtn.style.top = 'auto';
    }

    updateTouchJoystickKnob() {
        const knob = document.getElementById('touch-joystick-knob');
        if (!knob || !this.input || !this.input.stick) return;
        const maxOffset = 28;
        const dx = this.input.stick.dx * maxOffset;
        const dy = this.input.stick.dy * maxOffset;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
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
        
        // Fixed timestep update (same on mobile and PC: add time every rAF, run update when accumulator >= 33ms)
        this.accumulatorMs += deltaMs;
        let didUpdate = false;
        while (this.accumulatorMs >= this.fixedTimeStepMs) {
            this.update();
            this.accumulatorMs -= this.fixedTimeStepMs;
            didUpdate = true;
        }
        
        // Render only when a fixed update occurred
        if (didUpdate) {
            if (this.fx) {
                if (this.showDebugBounds) {
                    const fxT0 = performance.now();
                    this.fx.updateGlobal(this.gameTicks);
                    this.perfTimings.fxUpdateMs = performance.now() - fxT0;
                } else {
                    this.fx.updateGlobal(this.gameTicks);
                }
            }
            if (this.showDebugBounds) {
                this.perfTimings.rebuildFullMap = false;
                const t0 = performance.now();
                this.render();
                this.perfTimings.renderMs = performance.now() - t0;
            } else {
                this.render();
            }
        }

        this.updateTouchJoystickKnob();
        this.updateClientFps(currentMs, didUpdate);
        if (this.showDebugBounds && this.debugPerformanceEl) {
            const p = this.perfTimings;
            this.debugPerformanceEl.textContent =
                `input: ${p.inputMs.toFixed(2)}ms | network: ${p.networkMs.toFixed(2)}ms | update: ${p.updateMs.toFixed(2)}ms | fxUpdate: ${p.fxUpdateMs.toFixed(2)}ms | render: ${p.renderMs.toFixed(2)}ms | rebuildFullMap: ${p.rebuildFullMap}`;
        }
    }

    updateClientFps(currentMs, didUpdate) {
        if (!this.debugFps) return;
        if (!this.clientFpsLastMs) {
            this.clientFpsLastMs = currentMs;
        }
        if (didUpdate) {
            this.clientFpsFrames += 1;
        }
        const elapsed = currentMs - this.clientFpsLastMs;
        if (elapsed >= 1000) {
            this.clientFps = Math.round((this.clientFpsFrames * 1000) / elapsed);
            this.clientFpsFrames = 0;
            this.clientFpsLastMs = currentMs;
            if (this.showDebugBounds) {
                this.debugFps.textContent = `Client FPS: ${this.clientFps}`;
            }
        }
    }
    
    update() {
        if (this.state === 'ending') {
            this.updateEnding();
            return;
        }
        if (this.state !== 'playing') return;
        this.gameTicks += 1;
        
        const inputT0 = this.showDebugBounds ? performance.now() : 0;
        const bounds = this.getMapBounds();
        const controlEvents = this.input.getControlEvents();
        if (this.networkMode && this.networkClient) {
            const moveEvent = controlEvents.find((event) => (
                event === 'move_up'
                || event === 'move_down'
                || event === 'move_left'
                || event === 'move_right'
            ));
            const fire = controlEvents.includes('fire');
            this.networkClient.sendInput(moveEvent || null, fire);
            if (this.showDebugBounds) {
                this.perfTimings.inputMs = performance.now() - inputT0;
            }
            if (this.fx) {
                this.networkTanks.forEach((tank) => tank.updateFx(this.fx, this.gameTicks));
            }
            return;
        }
        if (this.showDebugBounds) {
            this.perfTimings.inputMs = performance.now() - inputT0;
        }
        const updateT0 = this.showDebugBounds ? performance.now() : 0;
        
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
            this.player.updateFx(this.fx, this.gameTicks);
        } else {
            // Player died
            if (!this.tryRespawnPlayer()) {
                if (this.showDebugBounds && updateT0) {
                    this.perfTimings.updateMs = performance.now() - updateT0;
                }
                this.beginGameOver();
                return;
            }
        }
        
        // Update bullets
        this.bullets.forEach((bullet) => {
            bullet.update(bounds, this.mapData);
        });
        this.bullets = this.bullets.filter(bullet => bullet.active);
        
        // HQ destroyed check
        if (this.playerHQ && this.mapData) {
            const hqTile = this.mapData.getTile(this.playerHQ.row, this.playerHQ.col);
            if (hqTile !== TILE_TYPES.PLAYER_HQ) {
                if (this.showDebugBounds && updateT0) {
                    this.perfTimings.updateMs = performance.now() - updateT0;
                }
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
            enemy.updateFx(this.fx, this.gameTicks);
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
                    this.logHit('enemy', enemy);
                    bullet.active = false;
                    
                    if (!enemy.isAlive()) {
                        if (this.fx) {
                            const center = this.getTankBoundCenter(enemy);
                            this.fx.playFx('destroy_tank', center.x, center.y);
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

        this.updateAIDebugPanel();
        
        // Remove dead enemies
        this.enemies = this.enemies.filter(enemy => enemy.isAlive());

        // FX updates handled by FxManager
        if (this.showDebugBounds && updateT0) {
            this.perfTimings.updateMs = performance.now() - updateT0;
        }
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
            this.fx.playFx('game_over', fxX, fxY);
        } else {
            this.gameOver();
        }
    }

    updateEnding() {
        if (this.fx) {
            this.fx.updateGlobal(this.gameTicks);
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
        if (this.maxEnemyCount <= 0 || this.enemies.length >= this.maxEnemyCount) {
            if (this.showDebugBounds) {
                this.appendSpawnDebugLine('ai respawn failed: max enemy count reached');
            }
            return;
        }
        const spawns = this.mapData.getSpawnPoints(TILE_TYPES.AI_SPAWN);
        if (spawns.length === 0) {
            if (this.showDebugBounds) {
                this.appendSpawnDebugLine('ai respawn failed: no AI spawn points');
            }
            return;
        }
        if (this.showDebugBounds) {
            const remainingSlots = Math.max(0, this.maxEnemyCount - this.enemies.length);
            this.appendSpawnDebugLine(`ai respawn slots available: ${remainingSlots}`);
        }
        const labelList = Array.isArray(window.GAME_CONFIG && window.GAME_CONFIG.aiTankLabels)
            ? window.GAME_CONFIG.aiTankLabels
            : ['normal_en'];
        const tankLabel = labelList[this.getRandomInt(labelList.length)] || 'normal_en';
        const spawnIndex = this.getRandomInt(spawns.length);
        let spawned = false;
        for (let i = 0; i < spawns.length; i += 1) {
            const index = (spawnIndex + i) % spawns.length;
            const spawn = spawns[index];
            const spawnPosition = this.getSpawnPositionForTank(tankLabel, TILE_TYPES.AI_SPAWN, spawn);
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
                this.enemies.push(enemy);
                spawned = true;
                break;
            }
        }
        if (!spawned && this.showDebugBounds) {
            this.appendSpawnDebugLine('ai respawn failed: no available spawn tile');
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

    mergeNetworkDelta(delta) {
        const base = this.networkState || {
            tick: 0,
            mapName: '',
            players: [],
            bullets: [],
            events: [],
            gameOver: false,
            gameOverReason: null,
            gameOverFx: 'destroy_hq',
            stats: null,
            aiDebug: null,
            gbeDebug: null
        };
        const next = { ...base };
        if (typeof delta.tick === 'number') next.tick = delta.tick;
        if (typeof delta.mapName === 'string') next.mapName = delta.mapName;
        if (Object.prototype.hasOwnProperty.call(delta, 'gameOver')) next.gameOver = !!delta.gameOver;
        if (Object.prototype.hasOwnProperty.call(delta, 'gameOverReason')) next.gameOverReason = delta.gameOverReason;
        if (Object.prototype.hasOwnProperty.call(delta, 'gameOverFx')) next.gameOverFx = delta.gameOverFx;
        if (Object.prototype.hasOwnProperty.call(delta, 'stats')) next.stats = delta.stats;
        if (Object.prototype.hasOwnProperty.call(delta, 'aiDebug')) next.aiDebug = delta.aiDebug;
        if (Object.prototype.hasOwnProperty.call(delta, 'gbeDebug')) next.gbeDebug = delta.gbeDebug;
        if (Object.prototype.hasOwnProperty.call(delta, 'events')) next.events = delta.events || [];
        else next.events = [];
        if (Object.prototype.hasOwnProperty.call(delta, 'mapTiles')) next.mapTiles = delta.mapTiles;
        if (Array.isArray(delta.mapTilesChanged)) next.mapTilesChanged = delta.mapTilesChanged;

        if (delta.players) {
            const playerMap = new Map((base.players || []).map((p) => [p.id, p]));
            const upserts = this.decodeEntityUpserts(
                delta.players,
                ['id', 'label', 'role', 'x', 'y', 'dirX', 'dirY', 'health', 'maxHealth'],
                'players'
            );
            upserts.forEach((entry) => {
                if (entry && entry.id) playerMap.set(entry.id, entry);
            });
            (delta.players.removed || []).forEach((id) => playerMap.delete(id));
            next.players = Array.from(playerMap.values());
        } else {
            next.players = base.players || [];
        }

        if (delta.bullets) {
            const bulletMap = new Map((base.bullets || []).map((b) => [b.id, b]));
            const upserts = this.decodeEntityUpserts(
                delta.bullets,
                ['id', 'x', 'y', 'dirX', 'dirY', 'radius'],
                'bullets'
            );
            upserts.forEach((entry) => {
                if (entry && entry.id) bulletMap.set(entry.id, entry);
            });
            (delta.bullets.removed || []).forEach((id) => bulletMap.delete(id));
            next.bullets = Array.from(bulletMap.values());
        } else {
            next.bullets = base.bullets || [];
        }
        return next;
    }

    appendGBEDebugLine(line, eventKey = null) {
        if (!this.showGBEDebug || !this.gbeDebugLog) return;
        const key = eventKey || line;
        if (this.gbeDebugLines.length > 0 && this.gbeLastEventKey === key) {
            const last = this.gbeDebugLines[this.gbeDebugLines.length - 1];
            last.count += 1;
        } else {
            this.gbeDebugLines.push({ text: line, count: 1, key });
            this.gbeLastEventKey = key;
            if (this.gbeDebugLines.length > 120) {
                this.gbeDebugLines.shift();
            }
        }
        this.gbeDebugLog.textContent = this.gbeDebugLines
            .map((item) => (item.count > 1 ? `[x${item.count}] ${item.text}` : item.text))
            .join('\n');
        this.gbeDebugLog.scrollTop = this.gbeDebugLog.scrollHeight;
    }

    decodeAIDebugPayload(packed, channel = 'ai') {
        if (!packed) return null;
        if (!Array.isArray(packed.values)) {
            return packed;
        }
        if (Array.isArray(packed.labels) && packed.labels.length > 0) {
            if (channel === 'gbe') this.gbeDebugLabels = packed.labels.slice();
            else this.aiDebugLabels = packed.labels.slice();
        }
        const labels = channel === 'gbe'
            ? (Array.isArray(this.gbeDebugLabels) ? this.gbeDebugLabels : null)
            : (Array.isArray(this.aiDebugLabels) ? this.aiDebugLabels : null);
        if (!labels || labels.length === 0) {
            return null;
        }
        const values = packed.values || [];
        const decoded = {};
        const limit = Math.min(labels.length, values.length);
        for (let i = 0; i < limit; i++) {
            decoded[labels[i]] = values[i];
        }
        return decoded;
    }

    decodeEntityUpserts(payload, fallbackLabels, cacheKey) {
        if (!payload || !Array.isArray(payload.upserts)) return [];
        let labels = null;
        if (Array.isArray(payload.labels) && payload.labels.length > 0) {
            labels = payload.labels.slice();
            if (cacheKey === 'players') this.networkPlayerStateLabels = labels;
            if (cacheKey === 'bullets') this.networkBulletStateLabels = labels;
        } else if (cacheKey === 'players' && Array.isArray(this.networkPlayerStateLabels)) {
            labels = this.networkPlayerStateLabels;
        } else if (cacheKey === 'bullets' && Array.isArray(this.networkBulletStateLabels)) {
            labels = this.networkBulletStateLabels;
        } else {
            labels = fallbackLabels;
        }
        return payload.upserts.map((entry) => {
            if (!Array.isArray(entry)) return entry;
            const decoded = {};
            const limit = Math.min(labels.length, entry.length);
            for (let i = 0; i < limit; i++) {
                decoded[labels[i]] = entry[i];
            }
            return decoded;
        });
    }

    applyNetworkState(state, isDelta = false) {
        const networkT0 = this.showDebugBounds ? performance.now() : 0;
        const resolvedState = isDelta ? this.mergeNetworkDelta(state) : state;
        this.networkState = resolvedState;
        this.backendAIDebug = this.decodeAIDebugPayload(resolvedState.aiDebug, 'ai');
        this.backendGBEDebug = this.decodeAIDebugPayload(resolvedState.gbeDebug, 'gbe');
        if (this.gbeDebugMeta && this.backendGBEDebug) {
            const sessionCount = typeof this.backendGBEDebug.sessionCount === 'number'
                ? this.backendGBEDebug.sessionCount
                : '--';
            const src = this.backendGBEDebug.stateSource || '--';
            const recvTotal = typeof this.backendGBEDebug.recvTotal === 'number'
                ? this.backendGBEDebug.recvTotal
                : '--';
            const appliedTotal = typeof this.backendGBEDebug.appliedTotal === 'number'
                ? this.backendGBEDebug.appliedTotal
                : '--';
            const errCount = typeof this.backendGBEDebug.errorCount === 'number'
                ? this.backendGBEDebug.errorCount
                : '--';
            const aiSockets = typeof this.backendGBEDebug.aiSocketCount === 'number'
                ? this.backendGBEDebug.aiSocketCount
                : '--';
            const clientSockets = typeof this.backendGBEDebug.clientSocketCount === 'number'
                ? this.backendGBEDebug.clientSocketCount
                : '--';
            const backendFps = typeof this.backendFps === 'number' && this.backendFps > 0
                ? this.backendFps
                : '--';
            this.gbeDebugMeta.textContent = `GBE src: ${src} | Sessions: ${sessionCount} | AI inputs recv/applied: ${recvTotal}/${appliedTotal} | sockets ai/client: ${aiSockets}/${clientSockets} | errCount: ${errCount} | Backend FPS: ${backendFps}`;
        }
        if (this.gbeDebugPerformance) {
            const perf = this.backendGBEDebug || {};
            const loopWaitMs = this.formatPerfMs(perf.loopWaitMs);
            const inputMs = this.formatPerfMs(perf.inputMs);
            const bulletsMs = this.formatPerfMs(perf.bulletsMs);
            const cooldownMs = this.formatPerfMs(perf.cooldownMs);
            const rewardMs = this.formatPerfMs(perf.rewardMs);
            const broadcastMs = this.formatPerfMs(perf.broadcastMs);
            const aiSendMs = this.formatPerfMs(perf.aiSendMs);
            this.gbeDebugPerformance.textContent =
                `Performance:\n` +
                `loopWaitMs=${loopWaitMs} inputMs=${inputMs} bulletsMs=${bulletsMs}\n` +
                `cooldownMs=${cooldownMs} rewardMs=${rewardMs} broadcastMs=${broadcastMs} aiSendMs=${aiSendMs}`;
        }
        if (this.gbePlayerIds && this.gbeAiIds) {
            const players = (resolvedState.players || []).filter((entry) => String(entry.label || '').endsWith('_pl'));
            const ais = (resolvedState.players || []).filter((entry) => String(entry.label || '').endsWith('_en'));
            this.gbePlayerIds.textContent = players.length
                ? players.map((entry) => String(entry.id || '').slice(0, 6)).join('\n')
                : '--';
            this.gbeAiIds.textContent = ais.length
                ? ais.map((entry) => String(entry.id || '').slice(0, 6)).join('\n')
                : '--';
        }
        if (resolvedState.mapTiles && this.mapData) {
            this.mapData.tiles = resolvedState.mapTiles;
            this.mapBaseCanvas = null;
            this.mapGrassCanvas = null;
        }
        if (Array.isArray(resolvedState.mapTilesChanged) && this.mapData && Array.isArray(this.mapData.tiles)) {
            resolvedState.mapTilesChanged.forEach((change) => {
                const row = change && Number.isInteger(change.row) ? change.row : -1;
                const col = change && Number.isInteger(change.col) ? change.col : -1;
                const tileId = change && Number.isInteger(change.tileId) ? change.tileId : null;
                if (row >= 0 && col >= 0 && tileId !== null && this.mapData.tiles[row] && col < this.mapData.tiles[row].length) {
                    this.mapData.tiles[row][col] = tileId;
                }
            });
            if (resolvedState.mapTilesChanged.length > 0 && this.mapBaseCanvas && this.mapGrassCanvas) {
                this.patchMapCaches(resolvedState.mapTilesChanged);
            }
        }
        if (resolvedState.stats) {
            const nextTick = typeof resolvedState.stats.ticks === 'number' ? resolvedState.stats.ticks : null;
            if (typeof nextTick === 'number') {
                const now = performance.now();
                if (typeof this.backendFpsLastTick === 'number') {
                    const tickDelta = nextTick - this.backendFpsLastTick;
                    const msDelta = now - this.backendFpsLastMs;
                    if (tickDelta > 0 && msDelta > 0) {
                        this.backendFps = Math.round((tickDelta * 1000) / msDelta);
                    }
                }
                this.backendFpsLastTick = nextTick;
                this.backendFpsLastMs = now;
                this.gameTicks = nextTick;
            }
            this.enemiesDestroyed = typeof resolvedState.stats.enemiesDestroyed === 'number'
                ? resolvedState.stats.enemiesDestroyed
                : this.enemiesDestroyed;
        }
        if (this.showGBEDebug && resolvedState.stats && typeof resolvedState.stats.ticks === 'number') {
            // GBE panel keeps event-focused logs.
        }
        const nextPlayers = [];
        const nextEnemies = [];
        const nextTanks = new Map();
        const nextPrevPositions = new Map();
        (resolvedState.players || []).forEach((entry) => {
            let tank = this.networkTanks.get(entry.id);
            if (!tank) {
                const def = this.tankDefinitions ? this.tankDefinitions[entry.label] : null;
                tank = new Tank(entry.x, entry.y, {
                    color: '#4CAF50',
                    textureImage: def ? def.textureImage : null,
                    boundMin: def ? def.bound_min : null,
                    boundMax: def ? def.bound_max : null,
                    speed: def ? def.speed : 2,
                    shellSize: def ? def.shell_size : 2,
                    shellSpeed: def ? def.shell_speed : 4,
                    shellColor: def ? def.shell_color : 'green',
                    health: entry.health,
                    maxHealth: entry.maxHealth,
                    cooldown: def ? def.cooldown : 0,
                    tileSize: this.mapData ? this.mapData.tileSize : null
                });
            }
            tank.x = entry.x;
            tank.y = entry.y;
            tank.health = entry.health;
            tank.maxHealth = entry.maxHealth;
            tank.setDirection(entry.dirX, entry.dirY);
            nextTanks.set(entry.id, tank);
            if (entry.id === this.networkPlayerId) {
                this.player = tank;
                const prev = this.networkPrevPositions.get(entry.id);
                const moved = prev ? (prev.x !== entry.x || prev.y !== entry.y) : false;
                if (this.fx) {
                    if (moved) {
                        tank.addFx('move', this.fx, entry.x, entry.y);
                    } else {
                        tank.stopFx('move');
                    }
                }
                nextPrevPositions.set(entry.id, { x: entry.x, y: entry.y });
            } else {
                nextEnemies.push(tank);
            }
            nextPlayers.push(tank);
        });
        this.networkTanks = nextTanks;
        this.enemies = nextEnemies;
        this.networkPrevPositions = nextPrevPositions;
        this.bullets = (resolvedState.bullets || []).map((bullet) => {
            const b = new Bullet(
                bullet.x,
                bullet.y,
                bullet.dirX,
                bullet.dirY,
                0,
                null,
                { radius: bullet.radius || 2, color: '#FFD700' }
            );
            b.active = true;
            return b;
        });

        if (this.fx && Array.isArray(resolvedState.events)) {
            resolvedState.events.forEach((event) => {
                if (event && event.type === 'fx' && event.name) {
                    this.fx.playFx(event.name, event.x, event.y);
                }
            });
        }

        if (resolvedState.gameOver && !this.gameOverStarted) {
            this.gameOverStarted = true;
            this.gameOverFxName = resolvedState.gameOverFx || 'destroy_hq';
            this.state = 'ending';
        }
        this.updateAIDebugPanel();

        if (this.showDebugBounds && resolvedState.tick && resolvedState.tick !== this.lastNetLogTick) {
            if (resolvedState.tick % 30 === 0) {
                this.appendSpawnDebugLine(
                    `net tick=${resolvedState.tick} recv=${this.netStats.tickRecv} sent=${this.netStats.tickSent} totalRecv=${this.netStats.totalRecv} totalSent=${this.netStats.totalSent}`
                );
                const b = this.netStats.breakdown || {};
                const partOrder = ['players', 'bullets', 'events', 'aiDebug', 'gbeDebug', 'stats', 'mapTilesChanged', 'meta'];
                const tickParts = b.recvStatePartsTick || {};
                const aiDebugBytes = typeof tickParts.aiDebug === 'number' ? tickParts.aiDebug : 0;
                const gbeDebugBytes = typeof tickParts.gbeDebug === 'number' ? tickParts.gbeDebug : 0;
                const tickPartsText = partOrder
                    .map((key) => `${key}=${typeof tickParts[key] === 'number' ? tickParts[key] : 0}`)
                    .join(', ');
                this.appendSpawnDebugLine(`net-breakdown recv:state parts tick aiDebugBytes=${aiDebugBytes}, gbeDebugBytes=${gbeDebugBytes} { ${tickPartsText} }`);
                this.appendSpawnDebugLine('');
                if (this.networkClient) {
                    this.networkClient.resetTickStats();
                }
            }
            this.lastNetLogTick = resolvedState.tick;
        }
        if (this.showDebugBounds && networkT0) {
            this.perfTimings.networkMs = performance.now() - networkT0;
        }
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
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.buildMapCaches();
        if (this.mapBaseCanvas) {
            this.ctx.drawImage(this.mapBaseCanvas, 0, 0);
        }
        if (this.showDebugBounds && !this.isMobile) {
            this.drawGrid();
        }
        if (this.state === 'playing') {
            if (this.player && this.player.isAlive()) {
                this.player.draw(this.ctx);
            }
            if (this.showDebugBounds && !this.isMobile) {
                this.drawPlayerCollisionBox();
                this.drawEnemyCollisionBoxes();
                this.updatePlayerTilePos();
                this.drawInitialPlayerSpawnRect();
            }
            this.bullets.forEach(bullet => bullet.draw(this.ctx));
            this.enemies.forEach(enemy => enemy.draw(this.ctx));
        }
        if (this.mapGrassCanvas) {
            this.ctx.drawImage(this.mapGrassCanvas, 0, 0);
        }
        if (this.showDebugBounds && !this.isMobile) {
            this.drawBlockingTileBounds();
        }
        if (this.state === 'playing' && this.fx) {
            if (this.player) this.player.drawFx(this.fx);
            this.enemies.forEach(enemy => enemy.drawFx(this.fx));
            this.fx.drawGlobal();
        } else if (this.fx) {
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
                this.drawOneTile(null, row, col, tileId, props, tileSize);
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
                this.drawOneTile(null, row, col, tileId, props, tileSize);
            }
        }
    }

    drawOneTile(ctx, row, col, tileId, props, tileSize) {
        const target = ctx || this.ctx;
        const x = col * tileSize;
        const y = row * tileSize;
        const img = this.tileImages[tileId];
        if (img) {
            target.drawImage(img, x, y, tileSize, tileSize);
        } else {
            target.fillStyle = props.color || '#000';
            target.fillRect(x, y, tileSize, tileSize);
        }
    }

    buildMapCaches() {
        if (!this.mapData || !this.mapData.tiles) return;
        const { tiles, tileSize } = this.mapData;
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (this.mapBaseCanvas && this.mapGrassCanvas) return;
        if (this.showDebugBounds) {
            this.perfTimings.rebuildFullMap = true;
        }
        this.mapBaseCanvas = document.createElement('canvas');
        this.mapBaseCanvas.width = w;
        this.mapBaseCanvas.height = h;
        const baseCtx = this.mapBaseCanvas.getContext('2d');
        baseCtx.fillStyle = '#1a1a2e';
        baseCtx.fillRect(0, 0, w, h);
        for (let row = 0; row < tiles.length; row++) {
            for (let col = 0; col < tiles[row].length; col++) {
                const tileId = tiles[row][col];
                const props = TILE_PROPERTIES[tileId];
                if (!props || props.invisible) continue;
                this.drawOneTile(baseCtx, row, col, tileId, props, tileSize);
            }
        }
        this.mapGrassCanvas = document.createElement('canvas');
        this.mapGrassCanvas.width = w;
        this.mapGrassCanvas.height = h;
        const grassCtx = this.mapGrassCanvas.getContext('2d');
        for (let row = 0; row < tiles.length; row++) {
            for (let col = 0; col < tiles[row].length; col++) {
                const tileId = tiles[row][col];
                const props = TILE_PROPERTIES[tileId];
                if (!props || !props.invisible) continue;
                this.drawOneTile(grassCtx, row, col, tileId, props, tileSize);
            }
        }
    }

    patchMapCaches(changes) {
        if (!this.mapBaseCanvas || !this.mapGrassCanvas || !this.mapData || !Array.isArray(changes) || changes.length === 0) return;
        if (this.showDebugBounds) {
            this.perfTimings.rebuildFullMap = false;
        }
        const { tileSize } = this.mapData;
        const baseCtx = this.mapBaseCanvas.getContext('2d');
        const grassCtx = this.mapGrassCanvas.getContext('2d');
        for (let i = 0; i < changes.length; i++) {
            const ch = changes[i];
            const row = ch && Number.isInteger(ch.row) ? ch.row : -1;
            const col = ch && Number.isInteger(ch.col) ? ch.col : -1;
            const tileId = ch && Number.isInteger(ch.tileId) ? ch.tileId : null;
            if (row < 0 || col < 0 || tileId === null) continue;
            const x = col * tileSize;
            const y = row * tileSize;
            baseCtx.fillStyle = '#1a1a2e';
            baseCtx.fillRect(x, y, tileSize, tileSize);
            grassCtx.clearRect(x, y, tileSize, tileSize);
            const props = TILE_PROPERTIES[tileId];
            if (!props) continue;
            if (props.invisible) {
                this.drawOneTile(grassCtx, row, col, tileId, props, tileSize);
            } else {
                this.drawOneTile(baseCtx, row, col, tileId, props, tileSize);
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
        if (this.sessionIdLabel) {
            const sessionId = this.currentSessionId || (this.networkClient ? this.networkClient.sessionId : null);
            this.sessionIdLabel.textContent = sessionId ? `Session: ${sessionId}` : 'Session: --';
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
        this.updateAutoRestartToggleUI();
        this.startAutoRestartTimer();
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
