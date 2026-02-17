# Analysis: Client FPS 60 vs 30, and slow movement/FX

## What’s going on

1. **Client FPS shows 60 but “should be capped by 30”**  
   The number on screen is the **requestAnimationFrame (rAF) rate**, not the **simulation (game update) rate**.

2. **Player tank and entity FX feel slow**  
   Movement and FX are driven by the **fixed timestep** (simulation). They run at ~30 updates per second. If you expect 60, or if the “60 FPS” display suggests the sim is 60, it will feel slow.

## Why FPS shows 60

- `gameLoop()` runs on every **rAF** (~60 times per second).
- **Render and game update** only run when `didUpdate` is true (once per 33 ms of accumulated time), so they run at ~30 times per second.
- **Client FPS** is updated in `updateClientFps(currentMs)`, which is called **every** `gameLoop()` run (every rAF), and it counts every call:

```text
gameLoop (rAF) → updateClientFps() → clientFpsFrames += 1  // every rAF
```

So the counter measures “how many times the loop ran per second” = **rAF rate ≈ 60**, not “how many simulation steps per second” = **30**.

## Why movement and FX feel slow

- Fixed timestep: `fixedTimeStepMs = 33` (~30 FPS).
- `update()` (and thus tank movement, FX, etc.) runs only when the accumulator has at least 33 ms: so **at most ~30 times per second**.
- Tank speed is “pixels per update”; FX advance one frame per update. So:
  - At 30 sim FPS → movement and FX run at 30 steps/sec (current behavior).
  - At 60 sim FPS → they would run twice as fast.

So the “slowness” matches the sim actually running at 30 FPS while the UI suggests 60.

## Summary

| What                         | Current behavior                         | What you want / expect      |
|-----------------------------|------------------------------------------|-----------------------------|
| Client FPS display          | Counts every rAF → shows ~60             | Should reflect sim → ~30   |
| Simulation (update) rate    | ~30/sec (33 ms step)                     | Capped by 30 (correct)     |
| Movement / FX perceived pace| 30 steps/sec (correct for 33 ms step)    | Feels slow if you expect 60|

## Fix (recommended)

- **FPS counter:** Only count a “frame” when a simulation step ran (`didUpdate === true`). Then “Client FPS” will show the simulation rate (~30) and match the movement/FX pace.
- **Pace:** If you want movement and FX to feel faster, either:
  - Keep 30 FPS and increase speeds / FX playback in config, or
  - Raise simulation rate (e.g. `fixedTimeStepMs = 16.67` for 60 sim FPS); then the FPS counter (after the fix) would show ~60.
