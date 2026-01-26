/**
 * Main Game Class
 * Handles the game loop and game state
 */
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.input = new InputHandler();
        
        // Set canvas size
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        // Game state
        this.state = 'menu'; // menu, playing, gameOver
        this.score = 0;
        this.lastTime = 0;
        this.accumulator = 0;
        this.fixedTimeStep = 1 / 60; // 60 FPS
        
        // Game entities
        this.player = null;
        this.bullets = [];
        this.enemies = [];
        
        // Shooting
        this.shootCooldown = 0;
        this.shootCooldownTime = 0.3; // seconds
        
        // Enemy spawning
        this.enemySpawnTimer = 0;
        this.enemySpawnInterval = 3; // seconds
        
        this.setupUI();
        this.init();
    }
    
    setupUI() {
        const startButton = document.getElementById('start-button');
        const restartButton = document.getElementById('restart-button');
        
        startButton.addEventListener('click', () => this.startGame());
        restartButton.addEventListener('click', () => this.startGame());
    }
    
    init() {
        // Initial setup
        this.updateUI();
    }
    
    startGame() {
        this.state = 'playing';
        this.score = 0;
        this.bullets = [];
        this.enemies = [];
        this.shootCooldown = 0;
        this.enemySpawnTimer = 0;
        
        // Create player tank
        this.player = new Tank(this.canvas.width / 2, this.canvas.height / 2, '#4CAF50');
        
        // Hide/show screens
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        
        this.updateUI();
        this.gameLoop(performance.now());
    }
    
    gameLoop(currentTime) {
        if (this.state !== 'playing') return;
        
        requestAnimationFrame((time) => this.gameLoop(time));
        
        // Calculate delta time
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1);
        this.lastTime = currentTime;
        
        // Fixed timestep update
        this.accumulator += deltaTime;
        while (this.accumulator >= this.fixedTimeStep) {
            this.update(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
        }
        
        // Render
        this.render();
    }
    
    update(deltaTime) {
        if (this.state !== 'playing') return;
        
        const mousePos = this.input.getMousePosition();
        
        // Update player
        if (this.player && this.player.isAlive()) {
            this.player.update(deltaTime, this.input, mousePos);
            
            // Shooting
            this.shootCooldown -= deltaTime;
            if (this.input.isMouseClicked() && this.shootCooldown <= 0) {
                this.shoot();
                this.shootCooldown = this.shootCooldownTime;
            }
        } else {
            // Player died
            this.gameOver();
            return;
        }
        
        // Update bullets
        this.bullets.forEach(bullet => bullet.update(deltaTime));
        this.bullets = this.bullets.filter(bullet => bullet.active);
        
        // Spawn enemies
        this.enemySpawnTimer += deltaTime;
        if (this.enemySpawnTimer >= this.enemySpawnInterval) {
            this.spawnEnemy();
            this.enemySpawnTimer = 0;
            // Increase spawn rate over time
            this.enemySpawnInterval = Math.max(1, this.enemySpawnInterval - 0.1);
        }
        
        // Update enemies
        this.enemies.forEach(enemy => {
            if (enemy.isAlive()) {
                // Simple AI: move towards player
                const dx = this.player.x - enemy.x;
                const dy = this.player.y - enemy.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    enemy.x += (dx / distance) * enemy.speed * deltaTime * 0.5;
                    enemy.y += (dy / distance) * enemy.speed * deltaTime * 0.5;
                }
                
                // Update angle to face player
                enemy.angle = Math.atan2(dy, dx);
            }
        });
        
        // Collision detection: bullets vs enemies
        this.bullets.forEach(bullet => {
            if (!bullet.active) return;
            
            this.enemies.forEach(enemy => {
                if (bullet.checkCollision(enemy) && bullet.owner !== enemy) {
                    enemy.takeDamage(25);
                    bullet.active = false;
                    
                    if (!enemy.isAlive()) {
                        this.score += 100;
                        this.updateUI();
                    }
                }
            });
        });
        
        // Collision detection: enemies vs player
        this.enemies.forEach(enemy => {
            if (!enemy.isAlive()) return;
            
            const dx = this.player.x - enemy.x;
            const dy = this.player.y - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < (this.player.width / 2 + enemy.width / 2)) {
                this.player.takeDamage(10 * deltaTime);
                this.updateUI();
            }
        });
        
        // Remove dead enemies
        this.enemies = this.enemies.filter(enemy => enemy.isAlive());
    }
    
    shoot() {
        if (!this.player || !this.player.isAlive()) return;
        
        const bulletX = this.player.x + Math.cos(this.player.angle) * (this.player.width / 2 + 20);
        const bulletY = this.player.y + Math.sin(this.player.angle) * (this.player.height / 2 + 20);
        
        const bullet = new Bullet(bulletX, bulletY, this.player.angle, 500, this.player);
        this.bullets.push(bullet);
    }
    
    spawnEnemy() {
        // Spawn enemy at random edge
        const side = Math.floor(Math.random() * 4);
        let x, y;
        
        switch (side) {
            case 0: // Top
                x = Math.random() * this.canvas.width;
                y = -20;
                break;
            case 1: // Right
                x = this.canvas.width + 20;
                y = Math.random() * this.canvas.height;
                break;
            case 2: // Bottom
                x = Math.random() * this.canvas.width;
                y = this.canvas.height + 20;
                break;
            case 3: // Left
                x = -20;
                y = Math.random() * this.canvas.height;
                break;
        }
        
        const enemy = new Tank(x, y, '#F44336');
        this.enemies.push(enemy);
    }
    
    render() {
        // Clear canvas
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw grid background
        this.drawGrid();
        
        if (this.state === 'playing') {
            // Draw player
            if (this.player && this.player.isAlive()) {
                this.player.draw(this.ctx);
            }
            
            // Draw bullets
            this.bullets.forEach(bullet => bullet.draw(this.ctx));
            
            // Draw enemies
            this.enemies.forEach(enemy => enemy.draw(this.ctx));
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
    }
    
    gameOver() {
        this.state = 'gameOver';
        document.getElementById('final-score').textContent = `Final Score: ${this.score}`;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
});
