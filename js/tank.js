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
        this.health = typeof options.health === 'number' ? options.health : 100;
        this.maxHealth = typeof options.maxHealth === 'number' ? options.maxHealth : this.health;
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
        if (!Array.isArray(events)) return;
        const moveSpeed = this.speed;
        let nextX = this.x;
        let nextY = this.y;

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
    }
    
    update(bounds = { width: 800, height: 600 }, mapData = null) {
        if (!this.active) return;
        
        this.x += this.dirX * this.speed;
        this.y += this.dirY * this.speed;
        
        // Deactivate if out of bounds
        if (this.x < 0 || this.x > bounds.width || this.y < 0 || this.y > bounds.height) {
            this.active = false;
            return;
        }

        if (mapData && mapData.blocksBullet) {
            const r = this.radius;
            const minCol = Math.floor((this.x - r) / mapData.tileSize);
            const maxCol = Math.floor((this.x + r) / mapData.tileSize);
            const minRow = Math.floor((this.y - r) / mapData.tileSize);
            const maxRow = Math.floor((this.y + r) / mapData.tileSize);
            for (let row = minRow; row <= maxRow; row += 1) {
                for (let col = minCol; col <= maxCol; col += 1) {
                    if (mapData.blocksBullet(row, col)) {
                        if (typeof window !== 'undefined' && typeof window.RenderFx === 'function') {
                            window.RenderFx('hit', this.x, this.y);
                        }
                        this.active = false;
                        return;
                    }
                }
            }
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
