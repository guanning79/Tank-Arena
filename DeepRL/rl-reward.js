// Reward shaping helpers.
(function initDeepRlReward() {
    const DeepRL = window.DeepRL || (window.DeepRL = {});

    DeepRL.computeStepReward = (params) => {
        const {
            enemy,
            player,
            mapData,
            hqTile,
            prevDistPlayer,
            prevDistHQ,
            idleTicks,
            directionChanged,
            ticksSinceDirChange,
            config
        } = params || {};
        const weights = config && config.rewardWeights ? config.rewardWeights : {};
        const playerDist = player ? DeepRL.computeDistance(enemy.x, enemy.y, player.x, player.y) : 0;
        const hqCenter = DeepRL.getHqCenter(mapData, hqTile);
        const hqDist = hqCenter ? DeepRL.computeDistance(enemy.x, enemy.y, hqCenter.x, hqCenter.y) : 0;
        const playerDelta = (typeof prevDistPlayer === 'number' ? prevDistPlayer : playerDist) - playerDist;
        const hqDelta = (typeof prevDistHQ === 'number' ? prevDistHQ : hqDist) - hqDist;
        let reward = 0;

        reward += playerDelta * (weights.playerApproach || 0);
        reward += hqDelta * (weights.hqApproach || 0);

        const aimThreshold = config && typeof config.aimDotThreshold === 'number'
            ? config.aimDotThreshold
            : 0.85;
        if (player) {
            const playerLos = DeepRL.hasLineOfSight(mapData, enemy.x, enemy.y, player.x, player.y);
            if (playerLos) {
                const playerAim = DeepRL.computeAimDot(
                    enemy.dirX || 0,
                    enemy.dirY || 0,
                    player.x - enemy.x,
                    player.y - enemy.y
                );
                if (playerAim >= aimThreshold) {
                    reward += weights.playerAim || 0;
                }
            }
        }
        if (hqCenter) {
            const hqLos = DeepRL.hasLineOfSight(mapData, enemy.x, enemy.y, hqCenter.x, hqCenter.y);
            if (hqLos) {
                const hqAim = DeepRL.computeAimDot(
                    enemy.dirX || 0,
                    enemy.dirY || 0,
                    hqCenter.x - enemy.x,
                    hqCenter.y - enemy.y
                );
                if (hqAim >= aimThreshold) {
                    reward += weights.hqAim || 0;
                }
            }
        }

        const idleThreshold = config && typeof config.idleTickThreshold === 'number'
            ? config.idleTickThreshold
            : 0;
        if (idleThreshold && idleTicks >= idleThreshold) {
            reward += weights.idlePenalty || 0;
        }
        if (directionChanged) {
            const cooldown = config && typeof config.directionChangeCooldown === 'number'
                ? config.directionChangeCooldown
                : 0;
            if (!cooldown || ticksSinceDirChange < cooldown) {
                reward += weights.directionChangePenalty || 0;
            }
        }

        return {
            reward,
            playerDist,
            hqDist
        };
    };
}());
