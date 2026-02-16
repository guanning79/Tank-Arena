# GBE, AI Backend, and RL Backend Flow

```mermaid
flowchart TB
    subgraph GBE [Game Backend - GBE]
        Sessions[Session registry]
        TickLoop[Tick loop]
        State[Game state]
        InputQueue[Input queues]
        Broadcast[Broadcast state]
        TickLoop --> State
        TickLoop --> InputQueue
        TickLoop --> Broadcast
        Sessions --> TickLoop
    end

    subgraph AI [AI Backend]
        Poll[Poll /sessions]
        EnsureSession[Ensure session]
        WS[WebSocket per session]
        Transition[Handle transition]
        Infer[Inference]
        Train[Train model]
        SendActions[Send actions]
        PersistQueue[Persist queue]
        LoadCatalog[Load model catalog]
        Transition --> Infer
        Transition --> Train
        Train --> PersistQueue
        Infer --> SendActions
        Poll --> EnsureSession
        EnsureSession --> WS
        WS --> Transition
    end

    subgraph RL [RL Backend]
        HTTP[HTTP API :5050]
        DB[(rl-models.db)]
        FreeList[Free list]
        HTTP --> DB
        HTTP --> FreeList
    end

    GBE -->|"GET /sessions"| Poll
    Poll -->|"session list"| AI
    EnsureSession -->|"WS connect"| GBE
    GBE -->|"transition (prevState, nextState, aiRewards)"| WS
    SendActions -->|"input (move, fire)"| GBE
    Broadcast -->|"state delta"| Clients[Game clients]

    LoadCatalog -->|"GET /api/rl-model-keys"| HTTP
    LoadCatalog -->|"GET /api/rl-model/{key}"| HTTP
    PersistQueue -->|"POST /api/rl-model/{key}"| HTTP
```

## Sequence (one AI session)

```mermaid
sequenceDiagram
    participant GBE as Game Backend
    participant AI as AI Backend
    participant RL as RL Backend

    Note over AI,RL: Startup
    AI->>RL: GET /api/rl-model-keys
    RL-->>AI: list of model keys
    loop For each key
        AI->>RL: GET /api/rl-model/{key}
        RL-->>AI: model weights
    end
    AI->>AI: Build model_pool, latest_saved

    Note over GBE,AI: Per session
    AI->>GBE: GET /sessions
    GBE-->>AI: sessions (sessionId, modelKey, ...)
    AI->>GBE: WS connect ?sessionId=...
    AI->>GBE: join (role=ai)
    loop Each tick (when transition sent)
        GBE->>AI: transition (prevState, nextState, aiRewards, tick)
        AI->>AI: apply state, compute rewards
        AI->>AI: train (if model)
        AI->>AI: choose_action (inference)
        AI->>GBE: input (tankId, move, fire, debug)
    end
    AI->>RL: POST /api/rl-model/{key} (async, from persist queue)

    Note over GBE,AI: Session end
    GBE->>AI: (session removed from /sessions)
    AI->>AI: release model to pool, close WS
```

## Ports and protocols

| Component    | Port | Role |
|-------------|------|------|
| Game Backend (GBE) | 5051 | HTTP (sessions, create, join, input), WebSocket (state, transitions) |
| AI Backend         | -    | Client only: HTTP to GBE and RL; WebSocket client to GBE |
| RL Backend         | 5050 | HTTP only (model keys, load, save, allocate, release) |
