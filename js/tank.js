/**
 * Tank Entity
 * Represents a tank in the game
 */
class Tank {
    constructor(x, y, color = '#4CAF50') {
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 40;
        this.color = color;
        this.angle = 0;
        this.speed = 200; // pixels per second
        this.health = 100;
        this.maxHealth = 100;
    }
    
    update(deltaTime, input, mousePos) {
        // Calculate movement
        const movement = input.getMovementVector();
        const moveSpeed = this.speed * deltaTime;
        
        this.x += movement.dx * moveSpeed;
        this.y += movement.dy * moveSpeed;
        
        // Keep tank within bounds (will be set by game)
        this.x = Math.max(this.width / 2, Math.min(this.x, 800 - this.width / 2));
        this.y = Math.max(this.height / 2, Math.min(this.y, 600 - this.height / 2));
        
        // Calculate angle to mouse
        const dx = mousePos.x - this.x;
        const dy = mousePos.y - this.y;
        this.angle = Math.atan2(dy, dx);
    }
    
    draw(ctx) {
        ctx.save();
        
        // Draw tank body
        ctx.translate(this.x, this.y);
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
}

/**
 * Bullet Entity
 */
class Bullet {
    constructor(x, y, angle, speed = 500, owner = null) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.speed = speed;
        this.radius = 5;
        this.owner = owner;
        this.active = true;
    }
    
    update(deltaTime) {
        if (!this.active) return;
        
        this.x += Math.cos(this.angle) * this.speed * deltaTime;
        this.y += Math.sin(this.angle) * this.speed * deltaTime;
        
        // Deactivate if out of bounds
        if (this.x < 0 || this.x > 800 || this.y < 0 || this.y > 600) {
            this.active = false;
        }
    }
    
    draw(ctx) {
        if (!this.active) return;
        
        ctx.save();
        ctx.fillStyle = '#FFD700';
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
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < this.radius + target.width / 2;
    }
}
