/**
 * Tank Entity
 * Represents a tank in the game
 */
class Tank {
    constructor(x, y, options = {}) {
        const tankSize = typeof TANK_IMG_SIZE !== 'undefined' ? TANK_IMG_SIZE : 40;
        this.x = x;
        this.y = y;
        this.width = tankSize;
        this.height = tankSize;
        this.color = options.color || '#4CAF50';
        this.textureImage = options.textureImage || null;
        this.boundMin = options.boundMin || null;
        this.boundMax = options.boundMax || null;
        this.tileSize = typeof options.tileSize === 'number' ? options.tileSize : null;
        this.angle = 0;
        this.dirX = 1;
        this.dirY = 0;
        this.speed = typeof options.speed === 'number' ? options.speed : 200; // pixels per event
        this.shellSize = typeof options.shellSize === 'number' ? options.shellSize : 5;
        this.shellSpeed = typeof options.shellSpeed === 'number' ? options.shellSpeed : 500;
        this.shellColor = options.shellColor || '#FFD700';
        this.cooldown = typeof options.cooldown === 'number' ? options.cooldown : 0;
        this.health = typeof options.health === 'number' ? options.health : 100;
        this.maxHealth = typeof options.maxHealth === 'number' ? options.maxHealth : this.health;
        this.fxList = [];
        this.fxPending = new Set();
    }
    
    setDirection(dx, dy) {
        this.dirX = dx;
        this.dirY = dy;
        if (dx > 0) this.angle = 0;
        else if (dx < 0) this.angle = Math.PI;
        else if (dy > 0) this.angle = Math.PI / 2;
        else if (dy < 0) this.angle = -Math.PI / 2;
    }

    update(events, bounds = { width: 800, height: 600 }, canOccupyFn = null, mapData = null) {
        if (!Array.isArray(events)) return false;
        const moveSpeed = this.speed;
        let nextX = this.x;
        let nextY = this.y;
        const startX = this.x;
        const startY = this.y;

        const canOccupy = (x, y) => {
            if (typeof canOccupyFn === 'function') {
                return canOccupyFn(x, y);
            }
            if (!mapData || !mapData.isAccessible) return true;
            const boundRect = this.getBoundRectAt(x, y);
            const points = [
                { x: boundRect.x + 1, y: boundRect.y + 1 },
                { x: boundRect.x + boundRect.w - 1, y: boundRect.y + 1 },
                { x: boundRect.x + 1, y: boundRect.y + boundRect.h - 1 },
                { x: boundRect.x + boundRect.w - 1, y: boundRect.y + boundRect.h - 1 }
            ];
            return points.every((point) => {
                const tile = mapData.pixelToTile(point.x, point.y);
                return mapData.isAccessible(tile.row, tile.col);
            });
        };

        const moveEvent = events.find((event) => (
            event === 'move_up'
            || event === 'move_down'
            || event === 'move_left'
            || event === 'move_right'
        ));

        if (moveEvent) {
            let dx = 0;
            let dy = 0;
            if (moveEvent === 'move_up') {
                dy = -moveSpeed;
                this.setDirection(0, -1);
            } else if (moveEvent === 'move_down') {
                dy = moveSpeed;
                this.setDirection(0, 1);
            } else if (moveEvent === 'move_left') {
                dx = -moveSpeed;
                this.setDirection(-1, 0);
            } else if (moveEvent === 'move_right') {
                dx = moveSpeed;
                this.setDirection(1, 0);
            }

            nextX = this.x + dx;
            nextY = this.y + dy;
            if (canOccupy(nextX, this.y)) {
                this.x = nextX;
            }
            if (canOccupy(this.x, nextY)) {
                this.y = nextY;
            }
        }
        
        // Keep tank within bounds using its local bounding box
        const boundRect = this.getBoundRectAt(this.x, this.y);
        if (boundRect.x < 0) {
            this.x += -boundRect.x;
        }
        if (boundRect.y < 0) {
            this.y += -boundRect.y;
        }
        if (boundRect.x + boundRect.w > bounds.width) {
            this.x -= boundRect.x + boundRect.w - bounds.width;
        }
        if (boundRect.y + boundRect.h > bounds.height) {
            this.y -= boundRect.y + boundRect.h - bounds.height;
        }
        
        // Face direction is only set by move events
        return this.x !== startX || this.y !== startY;
    }

    addFx(name, fxManager, x = this.x, y = this.y) {
        if (!fxManager || typeof fxManager.requestFx !== 'function') return;
        const config = fxManager.config ? fxManager.config[name] : null;
        if (config && config.unique) {
            const hasActive = this.fxList.some((fx) => fx.name === name && fx.state !== 'ended');
            if (hasActive) return;
        }
        if (!config) {
            if (this.fxPending.has(name)) return;
            this.fxPending.add(name);
            fxManager.requestFx(name, x, y, this.fxList, () => {
                this.fxPending.delete(name);
            });
            return;
        }
        fxManager.requestFx(name, x, y, this.fxList);
    }

    updateFx(fxManager) {
        if (!fxManager || typeof fxManager.updateList !== 'function') return;
        fxManager.updateList(this.fxList);
    }

    drawFx(fxManager) {
        if (!fxManager || typeof fxManager.drawList !== 'function') return;
        fxManager.drawList(this.fxList);
    }

    stopFx(name) {
        if (!name) return;
        for (let i = this.fxList.length - 1; i >= 0; i -= 1) {
            const fx = this.fxList[i];
            if (fx.name === name) {
                if (typeof fx.stop === 'function') {
                    fx.stop();
                }
                this.fxList.splice(i, 1);
            }
        }
    }

    stopAllFx() {
        for (let i = this.fxList.length - 1; i >= 0; i -= 1) {
            const fx = this.fxList[i];
            if (typeof fx.stop === 'function') {
                fx.stop();
            }
        }
        this.fxList = [];
        this.fxPending.clear();
    }
    
    draw(ctx) {
        ctx.save();
        
        // Draw tank body
        ctx.translate(this.x, this.y);
        const textureRotationOffset = Math.PI / 2;

        const imageReady = this.textureImage
            && (!('complete' in this.textureImage) || this.textureImage.complete);

        if (imageReady) {
            ctx.rotate(this.angle + textureRotationOffset);
            ctx.drawImage(
                this.textureImage,
                -this.width / 2,
                -this.height / 2,
                this.width,
                this.height
            );
        } else {
            ctx.rotate(this.angle);
            // Tank body (rectangle)
            ctx.fillStyle = this.color;
            ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
            
            // Tank outline
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
            
            // Tank barrel
            ctx.fillStyle = '#333';
            ctx.fillRect(this.width / 2 - 5, -5, 25, 10);
            ctx.strokeRect(this.width / 2 - 5, -5, 25, 10);
            
            // Tank turret (circle)
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#2d5a2d';
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
        
        // Draw health bar
        if (this.health < this.maxHealth) {
            const barWidth = 50;
            const barHeight = 6;
            const barX = this.x - barWidth / 2;
            const barY = this.y - this.height / 2 - 15;
            
            // Background
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Health
            const healthPercent = this.health / this.maxHealth;
            ctx.fillStyle = healthPercent > 0.5 ? '#4CAF50' : healthPercent > 0.25 ? '#FFC107' : '#F44336';
            ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
            
            // Border
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barWidth, barHeight);
        }
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health < 0) this.health = 0;
    }
    
    isAlive() {
        return this.health > 0;
    }

    getBoundRectAt(x, y) {
        const halfW = this.width >> 1;
        const halfH = this.height >> 1;
        const topLeftX = x - halfW;
        const topLeftY = y - halfH;
        if (!this.boundMin || !this.boundMax) {
            return {
                x: topLeftX,
                y: topLeftY,
                w: this.width,
                h: this.height
            };
        }
        return {
            x: topLeftX + this.boundMin.x,
            y: topLeftY + this.boundMin.y,
            w: Math.max(0, this.boundMax.x - this.boundMin.x + 1),
            h: Math.max(0, this.boundMax.y - this.boundMin.y + 1)
        };
    }

    getBoundRect() {
        return this.getBoundRectAt(this.x, this.y);
    }
}

/**
 * Bullet Entity
 */
class Bullet {
    constructor(x, y, dirX, dirY, speed = 500, owner = null, options = {}) {
        this.x = x;
        this.y = y;
        this.dirX = dirX;
        this.dirY = dirY;
        this.speed = speed;
        this.radius = typeof options.radius === 'number' ? options.radius : 5;
        this.color = options.color || '#FFD700';
        this.owner = owner;
        this.active = true;
        this.blockedByNonDestructible = false;
    }
    
    update(bounds = { width: 800, height: 600 }, mapData = null) {
        if (!this.active) return;
        this.blockedByNonDestructible = false;
        const startX = this.x;
        const startY = this.y;
        const endX = this.x + (this.dirX * this.speed);
        const endY = this.y + (this.dirY * this.speed);
        
        if (mapData && mapData.blocksBullet && mapData.isDestructible) {
            const tileSize = mapData.tileSize;
            const renderFxAtTileEdge = (row, col, posX, posY) => {
                if (typeof window === 'undefined' || typeof window.RenderFx !== 'function') return;
                const tileLeft = col * tileSize;
                const tileRight = tileLeft + tileSize;
                const tileTop = row * tileSize;
                const tileBottom = tileTop + tileSize;
                let fxX = posX;
                let fxY = posY;
                if (this.dirX > 0) fxX = tileLeft;
                else if (this.dirX < 0) fxX = tileRight;
                if (this.dirY > 0) fxY = tileTop;
                else if (this.dirY < 0) fxY = tileBottom;
                if (this.dirX !== 0 && this.dirY === 0) {
                    if (fxY < tileTop) fxY = tileTop;
                    if (fxY > tileBottom) fxY = tileBottom;
                } else if (this.dirY !== 0 && this.dirX === 0) {
                    if (fxX < tileLeft) fxX = tileLeft;
                    if (fxX > tileRight) fxX = tileRight;
                }
                window.RenderFx('hit', fxX, fxY);
            };

            const checkAt = (posX, posY) => {
                const r = this.radius;
                const minCol = Math.floor((posX - r) / tileSize);
                const maxCol = Math.floor((posX + r) / tileSize);
                const minRow = Math.floor((posY - r) / tileSize);
                const maxRow = Math.floor((posY + r) / tileSize);
                for (let row = minRow; row <= maxRow; row += 1) {
                    for (let col = minCol; col <= maxCol; col += 1) {
                        if (mapData.isDestructible(row, col)) {
                            renderFxAtTileEdge(row, col, posX, posY);
                            if (mapData.tiles && mapData.tiles[row]) {
                                const soilId = (typeof TILE_TYPES !== 'undefined' && TILE_TYPES.SOIL !== undefined)
                                    ? TILE_TYPES.SOIL
                                    : 0;
                                mapData.tiles[row][col] = soilId;
                            }
                            return true;
                        }
                        if (mapData.blocksBullet(row, col)) {
                            this.blockedByNonDestructible = true;
                            renderFxAtTileEdge(row, col, posX, posY);
                            return true;
                        }
                    }
                }
                return false;
            };

            const dx = endX - startX;
            const dy = endY - startY;
            const steps = Math.max(Math.abs(dx), Math.abs(dy));
            if (steps === 0) {
                if (checkAt(startX, startY)) {
                    this.active = false;
                    return;
                }
            } else {
                let x = startX;
                let y = startY;
                const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
                const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
                for (let i = 0; i <= steps; i += 1) {
                    if (checkAt(x, y)) {
                        this.active = false;
                        return;
                    }
                    x += stepX;
                    y += stepY;
                }
            }
        }

        this.x = endX;
        this.y = endY;
        
        // Deactivate if out of bounds
        if (this.x < 0 || this.x > bounds.width || this.y < 0 || this.y > bounds.height) {
            this.active = false;
            return;
        }
    }
    
    draw(ctx) {
        if (!this.active) return;
        
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }
    
    checkCollision(target) {
        if (!this.active || !target.isAlive()) return false;
        
        const dx = this.x - target.x;
        const dy = this.y - target.y;
        const sumR = this.radius + (target.width >> 1);
        return (dx * dx + dy * dy) < (sumR * sumR);
    }
}
