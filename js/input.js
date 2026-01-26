/**
 * Input Handler
 * Manages keyboard and mouse input for the game
 */
class InputHandler {
    constructor() {
        this.keys = {};
        this.mouse = {
            x: 0,
            y: 0,
            clicked: false,
            rightClicked: false
        };
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Keyboard events
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse events
        window.addEventListener('mousemove', (e) => {
            const canvas = document.getElementById('gameCanvas');
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        });
        
        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.mouse.clicked = true;
            } else if (e.button === 2) {
                this.mouse.rightClicked = true;
            }
        });
        
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.mouse.clicked = false;
            } else if (e.button === 2) {
                this.mouse.rightClicked = false;
            }
        });
        
        // Prevent context menu on right click
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    isKeyPressed(key) {
        return this.keys[key.toLowerCase()] === true;
    }
    
    getMovementVector() {
        let dx = 0;
        let dy = 0;
        
        // WASD or Arrow keys
        if (this.isKeyPressed('w') || this.isKeyPressed('arrowup')) dy -= 1;
        if (this.isKeyPressed('s') || this.isKeyPressed('arrowdown')) dy += 1;
        if (this.isKeyPressed('a') || this.isKeyPressed('arrowleft')) dx -= 1;
        if (this.isKeyPressed('d') || this.isKeyPressed('arrowright')) dx += 1;
        
        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            dx *= 0.707;
            dy *= 0.707;
        }
        
        return { dx, dy };
    }
    
    getMousePosition() {
        return { x: this.mouse.x, y: this.mouse.y };
    }
    
    isMouseClicked() {
        return this.mouse.clicked;
    }
    
    consumeMouseClick() {
        const clicked = this.mouse.clicked;
        this.mouse.clicked = false;
        return clicked;
    }
}
