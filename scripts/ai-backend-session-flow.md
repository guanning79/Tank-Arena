# AI Backend Session Flow

This document describes how one AI session performs inference, training, and persistence on the AI backend.

## Session Setup
- The AI backend polls `GET /sessions` on the Game Backend at a fixed interval (`AI_POLL_INTERVAL`).
- For each session ID, it creates a `SessionState` and opens one WebSocket to the Game Backend.
- It sends `{ type: "join", role: "ai", sessionId }` to bind the socket to that session.
- A model key is allocated from the pool for the session. If the pool is empty, the latest model for that base key is cloned and assigned.

## Inference Flow (Per Transition)
1. Game Backend sends a `transition` payload via WS:
   - `prevState`, `nextState`, `aiRewards`, and `tick`
2. AI backend merges deltas into the session state.
3. It updates per-session map tiles if `mapTilesChanged` is present.
4. For each AI tank, it builds a stacked state (last 4 state vectors).
5. It chooses an action with epsilon-greedy policy:
   - `action = choose_action(stacked_state)`
6. The action is mapped to `{ move, fire }` and sent back to the Game Backend as an `input` message.

## Training Flow (Per Transition)
1. For each reward entry in `aiRewards`:
   - Find the matching AI tank in the current state (by network ID).
   - Build the stacked state and run one Q-learning update.
2. This increments `model.steps` and decays `epsilon`.
3. Training metrics are tracked:
   - reward batch count and sum
   - training steps delta
   - training time and memory used by state vectors

## Persistence Flow
1. The model is persisted on a separate thread.
2. The main thread serializes the model payload to JSON and enqueues it.
3. The persistence thread POSTs the payload to the RL DB service:
   - `POST /api/rl-model/{modelKey}`
4. The most recent async save time is recorded for debug display.

## Session Teardown
- When a session ID is no longer returned by `GET /sessions`, the AI backend:
  - closes the session WebSocket,
  - releases the model key back to the pool.
