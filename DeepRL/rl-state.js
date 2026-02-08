// Build state vectors for DQN.
(function initDeepRlState() {
    const DeepRL = window.DeepRL || (window.DeepRL = {});

    DeepRL.buildState = (params) => {
        const {
            enemy,
            player,
            mapData,
            hqTile,
            bounds,
            idleTicks,
            aiTypeIndex,
            config
        } = params || {};
        const mapSize = bounds && bounds.width ? bounds.width : 1;
        const maxSpeed = config && typeof config.maxEnemySpeed === 'number' ? config.maxEnemySpeed : enemy.speed || 1;
        const hqCenter = DeepRL.getHqCenter(mapData, hqTile);
        const playerDx = player ? player.x - enemy.x : 0;
        const playerDy = player ? player.y - enemy.y : 0;
        const playerDist = player ? DeepRL.computeDistance(enemy.x, enemy.y, player.x, player.y) : 0;
        const hqDx = hqCenter ? hqCenter.x - enemy.x : 0;
        const hqDy = hqCenter ? hqCenter.y - enemy.y : 0;
        const hqDist = hqCenter ? DeepRL.computeDistance(enemy.x, enemy.y, hqCenter.x, hqCenter.y) : 0;
        const playerLos = player
            ? DeepRL.hasLineOfSight(mapData, enemy.x, enemy.y, player.x, player.y)
            : 0;
        const hqLos = hqCenter
            ? DeepRL.hasLineOfSight(mapData, enemy.x, enemy.y, hqCenter.x, hqCenter.y)
            : 0;
        const idleThreshold = config && typeof config.idleTickThreshold === 'number'
            ? config.idleTickThreshold
            : 1;
        const typeCount = config && Array.isArray(config.aiTankLabels) ? config.aiTankLabels.length : 1;
        const typeNorm = typeCount > 1 && typeof aiTypeIndex === 'number'
            ? aiTypeIndex / (typeCount - 1)
            : 0;
        const tiles = [];
        if (mapData && typeof mapData.pixelToTile === 'function') {
            const tile = mapData.pixelToTile(enemy.x, enemy.y);
            const maxTileId = config && typeof config.maxTileId === 'number' ? config.maxTileId : 7;
            for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
                for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
                    const row = tile.row + rowOffset;
                    const col = tile.col + colOffset;
                    const tileId = mapData.getTile(row, col);
                    const normalized = (typeof tileId === 'number')
                        ? (tileId + 1) / (maxTileId + 1)
                        : 0;
                    tiles.push(normalized);
                }
            }
        } else {
            for (let i = 0; i < 9; i += 1) tiles.push(0);
        }

        return [
            DeepRL.normalize(enemy.x, mapSize),
            DeepRL.normalize(enemy.y, mapSize),
            enemy.dirX || 0,
            enemy.dirY || 0,
            DeepRL.normalize(enemy.speed || 0, maxSpeed || 1),
            DeepRL.normalize(enemy.health || 0, enemy.maxHealth || 1),
            DeepRL.normalize(enemy.aiShootCooldownTicks || 0, enemy.aiShootCooldownMax || 1),
            DeepRL.normalize(playerDx, mapSize),
            DeepRL.normalize(playerDy, mapSize),
            DeepRL.normalize(playerDist, mapSize),
            playerLos,
            player ? DeepRL.normalize(player.health || 0, player.maxHealth || 1) : 0,
            DeepRL.normalize(hqDx, mapSize),
            DeepRL.normalize(hqDy, mapSize),
            DeepRL.normalize(hqDist, mapSize),
            hqLos,
            DeepRL.normalize(idleTicks || 0, idleThreshold),
            typeNorm,
            ...tiles
        ];
    };
}());
