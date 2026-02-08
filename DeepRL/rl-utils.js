// Shared utilities for Deep RL integration.
(function initDeepRlUtils() {
    const DeepRL = window.DeepRL || (window.DeepRL = {});

    DeepRL.normalize = (value, max) => {
        if (!max || !Number.isFinite(max)) return 0;
        return value / max;
    };

    DeepRL.computeDistance = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    };

    DeepRL.computeAimDot = (dirX, dirY, dx, dy) => {
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (!mag) return 0;
        return (dirX * dx + dirY * dy) / mag;
    };

    DeepRL.getHqCenter = (mapData, hqTile) => {
        if (!mapData || !hqTile) return null;
        const hqPos = mapData.tileToPixel(hqTile.col, hqTile.row);
        return {
            x: hqPos.x + mapData.tileSize / 2,
            y: hqPos.y + mapData.tileSize / 2
        };
    };

    DeepRL.hasLineOfSight = (mapData, fromX, fromY, toX, toY) => {
        if (!mapData || typeof mapData.isBulletPathBlocked !== 'function') return 0;
        return mapData.isBulletPathBlocked(fromX, fromY, toX, toY) ? 0 : 1;
    };

    DeepRL.mapActionToControlEvents = (actionIndex, config) => {
        const fallback = { move: null, fire: false };
        const actionMap = config && Array.isArray(config.actionMap) ? config.actionMap : [fallback];
        const action = actionMap[actionIndex] || actionMap[0] || fallback;
        const events = [];
        if (action.move) {
            events.push(action.move);
        }
        return { events, fire: !!action.fire };
    };

    DeepRL.pickRandomActionIndex = (config, options = {}) => {
        const fallback = { move: null, fire: false };
        const actionMap = config && Array.isArray(config.actionMap) ? config.actionMap : [fallback];
        if (!actionMap.length) return 0;
        const mode = options.mode || 'any';
        const candidates = [];
        for (let i = 0; i < actionMap.length; i += 1) {
            const action = actionMap[i];
            if (mode === 'move') {
                if (action && action.move) candidates.push(i);
            } else {
                candidates.push(i);
            }
        }
        if (!candidates.length) return 0;
        const idx = Math.floor(Math.random() * candidates.length);
        return candidates[idx];
    };
}());
