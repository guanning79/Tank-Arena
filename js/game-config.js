// Game configuration values.
(function initGameConfig() {
    const runtime = window.RUNTIME_CONFIG || {};
    const isHttps = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    const defaultHttp = (typeof window !== 'undefined' && window.location)
        ? window.location.origin
        : 'http://127.0.0.1:5051';
    const defaultWs = isHttps
        ? defaultHttp.replace(/^https:/, 'wss:') + '/ws'
        : defaultHttp.replace(/^http:/, 'ws:') + '/ws';

    window.GAME_CONFIG = {
        initialMap: 'maps/Stage03.json',
        sfxVolume: 0.5,
        backendUrl: runtime.backendUrl || defaultHttp,
        backendWsUrl: runtime.backendWsUrl || defaultWs,
        maxEnemiesAlive: 4,
        aiTankLabels: ['normal_en', 'speedy_en', 'heavy_en', 'rapid_en']
    };
})();
