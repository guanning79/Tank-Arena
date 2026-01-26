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

1. Open `index.html` in a web browser
2. Click "Start Game"
3. Use **WASD** or **Arrow Keys** to move your tank
4. Use **Mouse** to aim
5. **Left Click** to shoot
6. Survive as long as possible and defeat enemies!

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
├── index.html          # Main HTML file
├── css/
│   └── style.css       # Game styling
├── js/
│   ├── game.js         # Main game loop and game logic
│   ├── tank.js         # Tank and bullet entities
│   └── input.js        # Input handling
└── README.md           # This file
```

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
