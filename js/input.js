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
        this.stick = { dx: 0, dy: 0 };
        this.touchFirePressed = false;
        this._stickPointerId = null;
        this._stickBaseRect = null;
        this.STICK_DEADZONE = 0.2;
        this.STICK_RADIUS = 1;

        this.setupEventListeners();
        this.setupTouchListeners();
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

    setupTouchListeners() {
        const base = document.getElementById('touch-joystick-base');
        const fireBtn = document.getElementById('touch-fire-button');
        if (!base || !fireBtn) return;

        base.addEventListener('pointerdown', (e) => {
            if (this._stickPointerId !== null) return;
            e.preventDefault();
            this._stickPointerId = e.pointerId;
            this._stickBaseRect = base.getBoundingClientRect();
            this.updateStickFromEvent(e);
        }, { passive: false });
        window.addEventListener('pointermove', (e) => {
            if (e.pointerId !== this._stickPointerId) return;
            e.preventDefault();
            this.updateStickFromEvent(e);
        }, { passive: false });
        window.addEventListener('pointerup', (e) => {
            if (e.pointerId !== this._stickPointerId) return;
            this._stickPointerId = null;
            this.stick.dx = 0;
            this.stick.dy = 0;
        });
        window.addEventListener('pointercancel', (e) => {
            if (e.pointerId === this._stickPointerId) {
                this._stickPointerId = null;
                this.stick.dx = 0;
                this.stick.dy = 0;
            }
        });

        fireBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.touchFirePressed = true;
        }, { passive: false });
        fireBtn.addEventListener('pointerup', () => { this.touchFirePressed = false; });
        fireBtn.addEventListener('pointerleave', () => { this.touchFirePressed = false; });
        fireBtn.addEventListener('pointercancel', () => { this.touchFirePressed = false; });
    }

    updateStickFromEvent(e) {
        if (!this._stickBaseRect) return;
        const cx = this._stickBaseRect.left + this._stickBaseRect.width / 2;
        const cy = this._stickBaseRect.top + this._stickBaseRect.height / 2;
        const clientX = 'clientX' in e ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : cx);
        const clientY = 'clientY' in e ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : cy);
        let dx = (clientX - cx) / (this._stickBaseRect.width / 2);
        let dy = (clientY - cy) / (this._stickBaseRect.height / 2);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > this.STICK_RADIUS) {
            dx = (dx / len) * this.STICK_RADIUS;
            dy = (dy / len) * this.STICK_RADIUS;
        }
        this.stick.dx = dx;
        this.stick.dy = dy;
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
        
        // Touch stick (additive)
        if (Math.abs(this.stick.dx) > this.STICK_DEADZONE || Math.abs(this.stick.dy) > this.STICK_DEADZONE) {
            dx += this.stick.dx;
            dy += this.stick.dy;
        }
        
        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            dx *= 0.707;
            dy *= 0.707;
        }
        
        return { dx, dy };
    }

    getControlEvents() {
        const events = [];
        if (this.isKeyPressed('w') || this.isKeyPressed('arrowup')) events.push('move_up');
        if (this.isKeyPressed('s') || this.isKeyPressed('arrowdown')) events.push('move_down');
        if (this.isKeyPressed('a') || this.isKeyPressed('arrowleft')) events.push('move_left');
        if (this.isKeyPressed('d') || this.isKeyPressed('arrowright')) events.push('move_right');
        if (this.isMouseClicked()) events.push('fire');
        const d = this.STICK_DEADZONE;
        if (Math.abs(this.stick.dy) >= Math.abs(this.stick.dx)) {
            if (this.stick.dy < -d) events.push('move_up');
            else if (this.stick.dy > d) events.push('move_down');
        } else {
            if (this.stick.dx < -d) events.push('move_left');
            else if (this.stick.dx > d) events.push('move_right');
        }
        if (this.touchFirePressed) events.push('fire');
        return events;
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
