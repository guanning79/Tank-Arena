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
    trainEvery: 4,
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
        hitPlayer: 2.0,
        gotHit: -2.0,
        destroyHQ: 5.0,
        death: -5.0,
        playerApproach: 0.05,
        hqApproach: 0.1,
        playerAim: 0.01,
        hqAim: 0.01,
        idlePenalty: -0.05,
        directionChangePenalty: -0.05,
        nonDestructiveShotPenalty: -0.03,
        hitAlly: -1.0
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
