/**
 * Network client for frame-sync backend.
 */
class NetworkClient {
    constructor(options) {
        this.backendUrl = options.backendUrl;
        this.wsUrl = options.wsUrl;
        this.onState = options.onState;
        this.onNetStats = options.onNetStats;
        this.socket = null;
        this.sessionId = null;
        this.playerId = null;
        this.netSent = 0;
        this.netRecv = 0;
        this.tickSent = 0;
        this.tickRecv = 0;
        this.breakdown = {
            recvState: 0,
            recvOther: 0,
            sentInput: 0,
            sentJoin: 0,
            sentDebugToggle: 0,
            sentOther: 0,
            tickRecvState: 0,
            tickRecvOther: 0,
            tickSentInput: 0,
            tickSentJoin: 0,
            tickSentDebugToggle: 0,
            tickSentOther: 0,
            recvStatePartsTotal: this.createStatePartsCounter(),
            recvStatePartsTick: this.createStatePartsCounter()
        };
        this.encoder = new TextEncoder();
    }

    createStatePartsCounter() {
        return {
            players: 0,
            bullets: 0,
            events: 0,
            aiDebug: 0,
            gbeDebug: 0,
            stats: 0,
            mapTilesChanged: 0,
            meta: 0
        };
    }

    measureJsonBytes(value) {
        try {
            return this.encoder.encode(JSON.stringify(value)).length;
        } catch (error) {
            return 0;
        }
    }

    updateStatePartBreakdown(state) {
        if (!state || typeof state !== 'object') return;
        const partKeys = ['players', 'bullets', 'events', 'aiDebug', 'gbeDebug', 'stats', 'mapTilesChanged'];
        for (const key of partKeys) {
            if (Object.prototype.hasOwnProperty.call(state, key)) {
                const size = this.measureJsonBytes(state[key]);
                this.breakdown.recvStatePartsTotal[key] += size;
                this.breakdown.recvStatePartsTick[key] += size;
            }
        }
        const metaObj = {};
        for (const key of Object.keys(state)) {
            if (!partKeys.includes(key)) {
                metaObj[key] = state[key];
            }
        }
        const metaSize = Object.keys(metaObj).length > 0 ? this.measureJsonBytes(metaObj) : 0;
        this.breakdown.recvStatePartsTotal.meta += metaSize;
        this.breakdown.recvStatePartsTick.meta += metaSize;
    }

    async createSession(mapName, options = {}) {
        const payloadBody = { mapName };
        if (typeof options.maxEnemiesAlive === 'number') {
            payloadBody.maxEnemiesAlive = options.maxEnemiesAlive;
        }
        const response = await fetch(`${this.backendUrl}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBody)
        });
        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.statusText}`);
        }
        const payload = await response.json();
        this.sessionId = payload.sessionId;
        this.playerId = payload.playerId;
        return payload;
    }

    async joinSession(sessionId) {
        const response = await fetch(`${this.backendUrl}/session/${sessionId}/join`, {
            method: 'POST'
        });
        if (!response.ok) {
            throw new Error(`Failed to join session: ${response.statusText}`);
        }
        const payload = await response.json();
        this.sessionId = payload.sessionId;
        this.playerId = payload.playerId;
        return payload;
    }

    connect(role = 'player') {
        return new Promise((resolve, reject) => {
            if (!this.sessionId) {
                reject(new Error('Missing sessionId'));
                return;
            }
            const wsUrl = `${this.wsUrl}?sessionId=${this.sessionId}`;
            this.socket = new WebSocket(wsUrl);
            this.socket.addEventListener('open', () => {
                this.send({
                    type: 'join',
                    sessionId: this.sessionId,
                    role,
                    playerId: this.playerId
                });
                resolve();
            });
            this.socket.addEventListener('message', (event) => {
                const data = typeof event.data === 'string' ? event.data : '';
                const size = this.encoder.encode(data).length;
                let message = null;
                let messageType = 'other';
                if (data) {
                    try {
                        message = JSON.parse(data);
                        messageType = message && message.type ? message.type : 'other';
                    } catch (error) {
                        messageType = 'other';
                    }
                }
                this.netRecv += size;
                this.tickRecv += size;
                if (messageType === 'state') {
                    this.breakdown.recvState += size;
                    this.breakdown.tickRecvState += size;
                    if (message && message.state) {
                        this.updateStatePartBreakdown(message.state);
                    }
                } else {
                    this.breakdown.recvOther += size;
                    this.breakdown.tickRecvOther += size;
                }
                if (this.onNetStats) {
                    this.onNetStats({
                        totalRecv: this.netRecv,
                        totalSent: this.netSent,
                        tickRecv: this.tickRecv,
                        tickSent: this.tickSent,
                        breakdown: {
                            ...this.breakdown,
                            recvStatePartsTotal: { ...this.breakdown.recvStatePartsTotal },
                            recvStatePartsTick: { ...this.breakdown.recvStatePartsTick }
                        }
                    });
                }
                if (!data) return;
                if (message && message.type === 'state' && this.onState) {
                    this.onState(message.state, !!(message.state && message.state.delta));
                }
            });
            this.socket.addEventListener('error', (event) => {
                reject(event);
            });
        });
    }

    sendInput(move, fire) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        if (!this.playerId) return;
        this.send({
            type: 'input',
            role: 'player',
            tankId: this.playerId,
            move,
            fire: !!fire
        });
    }

    setDebugAI(enabled) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.send({
            type: 'debug_ai_toggle',
            enabled: !!enabled
        });
    }

    setDebugGBE(enabled) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.send({
            type: 'debug_gbe_toggle',
            enabled: !!enabled
        });
    }

    send(payload) {
        const data = JSON.stringify(payload);
        const size = this.encoder.encode(data).length;
        this.netSent += size;
        this.tickSent += size;
        const type = payload && payload.type ? payload.type : 'other';
        if (type === 'input') {
            this.breakdown.sentInput += size;
            this.breakdown.tickSentInput += size;
        } else if (type === 'join') {
            this.breakdown.sentJoin += size;
            this.breakdown.tickSentJoin += size;
        } else if (type === 'debug_ai_toggle') {
            this.breakdown.sentDebugToggle += size;
            this.breakdown.tickSentDebugToggle += size;
        } else {
            this.breakdown.sentOther += size;
            this.breakdown.tickSentOther += size;
        }
        if (this.onNetStats) {
            this.onNetStats({
                totalRecv: this.netRecv,
                totalSent: this.netSent,
                tickRecv: this.tickRecv,
                tickSent: this.tickSent,
                breakdown: {
                    ...this.breakdown,
                    recvStatePartsTotal: { ...this.breakdown.recvStatePartsTotal },
                    recvStatePartsTick: { ...this.breakdown.recvStatePartsTick }
                }
            });
        }
        this.socket.send(data);
    }

    resetTickStats() {
        this.tickSent = 0;
        this.tickRecv = 0;
        this.breakdown.tickRecvState = 0;
        this.breakdown.tickRecvOther = 0;
        this.breakdown.tickSentInput = 0;
        this.breakdown.tickSentJoin = 0;
        this.breakdown.tickSentDebugToggle = 0;
        this.breakdown.tickSentOther = 0;
        this.breakdown.recvStatePartsTick = this.createStatePartsCounter();
    }
}
