// Deep RL configuration for Tank Arena.
window.RL_CONFIG = {
    enabled: true,
    tfjsUrl: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js',
    workerScript: 'DeepRL/dqn-worker.js',
    modelStorageKey: 'tank-ai-dqn',
    baseModelStorageKey: 'tank-ai-dqn',
    mapKeyOverride: '',
    mapKey: '',
    persistenceMode: 'backend',
    backendUrl: 'http://127.0.0.1:5050',
    hiddenLayers: [64, 64],
    learningRate: 0.001,
    gamma: 0.95,
    batchSize: 32,
    replaySize: 10000,
    trainEvery: 3,
    transiteGenInterval: 3, // GBE sends one transition every N ticks.
    targetUpdateEvery: 200,
    epsilon: {
        start: 1.0,
        min: 0.1,
        decay: 0.9995
    },
    saveEverySteps: 2000,
    saveEveryEpisodes: 3,
    maxEnemiesAlive: 4,
    idleTickThreshold: 20,
    aimDotThreshold: 0.85,
    maxEnemySpeed: 4,
    rewardWeights: {
        hitPlayer: 2.0, // AI shell predicted to hit player.
        gotHit: -0.5, // AI tank predicted to be hit by a shell.
        destroyHQ: 3.0, // AI shell predicted to hit HQ.
        death: -1.0, // AI tank destroyed.
        playerAim: 0.05, // AI aims at player (LOS + aim dot threshold).
        hqAim: 0.1, // AI aims at HQ (LOS + aim dot threshold).
        exploreStallPenalty: -0.001, // AI stalls without exploring new tiles.
        mapTileTouched: 0.04, // AI touches a new map tile.
        idlePenalty: -0.05, // AI stays idle too long.
        directionChangePenalty: -0.05, // AI changes direction too frequently.
        nonDestructiveShotPenalty: -0.03, // AI shell predicted to hit non-destructive tile.
        destructiveShot: 0.1, // AI shell predicted to hit destructive tile.
        hitAlly: -1.0, // AI shell predicted to hit another AI.
        collisionPenalty: -0.03, // AI move blocked by collision.
        stuckAreaPenalty: -0.05 // AI stays in the same 3x3 tiles too long.
    },
    directionChangeCooldown: 6,
    maxTileId: 7,
    aiTankLabels: ['normal_en', 'speedy_en', 'heavy_en', 'rapid_en'],
    actionMap: [
        { move: null, fire: false }, // idle
        { move: 'move_up', fire: false },
        { move: 'move_down', fire: false },
        { move: 'move_left', fire: false },
        { move: 'move_right', fire: false },
        { move: null, fire: true }, // fire
        { move: 'move_up', fire: true },
        { move: 'move_down', fire: true },
        { move: 'move_left', fire: true },
        { move: 'move_right', fire: true }
    ],
    actionResponseTimeoutMs: 200,
    stuckActionThreshold: 40,
    stuckActionMode: 'move'
};
