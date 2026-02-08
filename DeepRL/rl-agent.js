// Main-thread bridge for the DQN worker.
(function initDeepRlAgent() {
    const DeepRL = window.DeepRL || (window.DeepRL = {});

    class DqnAgentController {
        constructor(config) {
            this.config = config || {};
            this.worker = null;
            this.actions = new Map();
            this.isInitialized = false;
            this.debugInfo = {
                state: '--',
                action: '--',
                reward: '--',
                epsilon: '--',
                loss: '--',
                steps: '--',
                episodes: '--',
                buildState: false,
                sentObserve: false,
                workerAction: false,
                returnedAction: false
            };
        }

        init(stateSize, actionSize) {
            if (this.isInitialized) return;
            if (!this.config.workerScript) return;
            this.worker = new Worker(this.config.workerScript);
            this.worker.onmessage = (event) => this.handleMessage(event.data);
            this.worker.postMessage({
                type: 'init',
                stateSize,
                actionSize,
                config: {
                    tfjsUrl: this.config.tfjsUrl,
                    modelStorageKey: this.config.modelStorageKey,
                    backendUrl: this.config.backendUrl,
                    hiddenLayers: this.config.hiddenLayers,
                    learningRate: this.config.learningRate,
                    gamma: this.config.gamma,
                    batchSize: this.config.batchSize,
                    replaySize: this.config.replaySize,
                    trainEvery: this.config.trainEvery,
                    targetUpdateEvery: this.config.targetUpdateEvery,
                    epsilon: this.config.epsilon,
                    saveEverySteps: this.config.saveEverySteps,
                    saveEveryEpisodes: this.config.saveEveryEpisodes
                }
            });
            this.worker.postMessage({
                type: 'load',
                storageKey: this.config.modelStorageKey
            });
            this.isInitialized = true;
        }

        observe(payload) {
            if (!this.isInitialized || !this.worker) return;
            this.worker.postMessage({
                type: 'observe',
                id: payload.id,
                state: payload.state,
                reward: payload.reward,
                done: payload.done
            });
        }

        getAction(id) {
            if (this.actions.has(id)) {
                return this.actions.get(id).action;
            }
            return 0;
        }

        getActionInfo(id) {
            if (this.actions.has(id)) {
                return this.actions.get(id);
            }
            return null;
        }

        resetEpisode() {
            this.actions.clear();
        }

        getDebugInfo() {
            return this.debugInfo;
        }

        setDebugStep(flags) {
            if (!flags) return;
            this.debugInfo = {
                ...this.debugInfo,
                ...flags
            };
        }

        handleMessage(msg) {
            if (!msg || !msg.type) return;
            if (msg.type === 'action') {
                this.actions.set(msg.id, { action: msg.action, time: Date.now() });
                this.debugInfo = {
                    state: msg.id,
                    action: msg.action,
                    reward: typeof msg.reward === 'number' ? msg.reward.toFixed(3) : '--',
                    epsilon: typeof msg.epsilon === 'number' ? msg.epsilon.toFixed(3) : '--',
                    loss: typeof msg.loss === 'number' ? msg.loss.toFixed(4) : '--',
                    steps: typeof msg.steps === 'number' ? msg.steps : '--',
                    episodes: typeof msg.episodes === 'number' ? msg.episodes : '--',
                    buildState: true,
                    sentObserve: true,
                    workerAction: true,
                    returnedAction: true
                };
                return;
            }
            if (msg.type === 'error') {
                console.error('DeepRL worker error:', msg.error || msg.message);
            }
        }
    }

    DeepRL.DqnAgentController = DqnAgentController;
}());
