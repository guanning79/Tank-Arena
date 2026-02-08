# Tank Arena

An HTML5 tank arena game built with vanilla JavaScript. Control your tank, shoot enemies, and survive as long as possible!

## Features

- **Smooth Game Loop**: Fixed timestep game loop for consistent gameplay
- **Tank Controls**: WASD or Arrow keys for movement, mouse for aiming
- **Enemy AI**: Enemies spawn and chase the player
- **Combat System**: Shoot bullets to defeat enemies
- **Health System**: Take damage from enemy collisions
- **Score System**: Earn points by defeating enemies
- **Modern UI**: Clean interface with start and game over screens

## How to Play

1. Start the game server (see "Local Dev Server")
2. Open `http://127.0.0.1:5173` in a web browser
3. Click "Start Game"
4. Use **WASD** or **Arrow Keys** to move your tank
5. Use **Mouse** to aim
6. **Left Click** to shoot
7. Survive as long as possible and defeat enemies!

## Game Mechanics

- **Movement**: Tank moves in 8 directions based on input
- **Aiming**: Tank turret always faces the mouse cursor
- **Shooting**: Click to fire bullets (cooldown: 0.3 seconds)
- **Enemies**: Spawn from edges and chase the player
- **Damage**: Colliding with enemies deals damage over time
- **Scoring**: Defeat enemies to earn 100 points each

## Project Structure

```
Tank Arena/
├── start-dev.bat        # Start backend + game server (Windows)
├── index.html          # Main HTML file
├── css/
│   └── style.css       # Game styling
├── js/
│   ├── game.js         # Main game loop and game logic
│   ├── tank.js         # Tank and bullet entities
│   └── input.js        # Input handling
├── DeepRL/
│   └── backend/
│       └── server.py   # Local backend DB for RL
└── README.md           # This file
```

## Local Dev Server

The game uses a local server plus the DeepRL backend for persistence.

### Windows (batch)

```
start-dev.bat
```

This starts:
- Backend: `http://127.0.0.1:5050`
- Game: `http://127.0.0.1:5173`

## Technical Details

- **Canvas Size**: 800x600 pixels
- **Frame Rate**: 60 FPS with fixed timestep
- **Rendering**: HTML5 Canvas 2D API
- **No Dependencies**: Pure vanilla JavaScript

## Future Enhancements

- Power-ups and upgrades
- Different enemy types
- Multiple levels
- Sound effects and music
- Particle effects
- Mobile touch controls

## License

Free to use and modify.
