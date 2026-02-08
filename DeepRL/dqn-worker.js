/* DQN worker for in-browser training. */
let tf = null;
let config = null;
let model = null;
let targetModel = null;
let stateSize = 0;
let actionSize = 0;
let steps = 0;
let episodes = 0;
let epsilon = 1.0;
let lastLoss = null;
let backendUrl = '';
let replay = [];
let replayIndex = 0;
const prevState = new Map();
const prevAction = new Map();

const setupTf = async (tfjsUrl) => {
    if (tf) return;
    importScripts(tfjsUrl);
    tf = self.tf;
};

const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const base64ToArrayBuffer = (base64) => {
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

const saveToBackend = async () => {
    if (!backendUrl || !config.modelStorageKey) return;
    const handler = tf.io.withSaveHandler(async (artifacts) => {
        const payload = {
            modelTopology: artifacts.modelTopology,
            weightSpecs: artifacts.weightSpecs,
            weightDataBase64: arrayBufferToBase64(artifacts.weightData),
            trainingConfig: artifacts.trainingConfig || null,
            userDefinedMetadata: artifacts.userDefinedMetadata || null
        };
        await fetch(`${backendUrl}/api/rl-model/${encodeURIComponent(config.modelStorageKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return { modelArtifactsInfo: artifacts.modelArtifactsInfo };
    });
    await model.save(handler);
};

const loadFromBackend = async () => {
    if (!backendUrl || !config.modelStorageKey) return false;
    const response = await fetch(`${backendUrl}/api/rl-model/${encodeURIComponent(config.modelStorageKey)}`);
    if (!response.ok) return false;
    const payload = await response.json();
    if (!payload || !payload.modelTopology || !payload.weightSpecs || !payload.weightDataBase64) {
        return false;
    }
    const handler = tf.io.fromMemory({
        modelTopology: payload.modelTopology,
        weightSpecs: payload.weightSpecs,
        weightData: base64ToArrayBuffer(payload.weightDataBase64),
        trainingConfig: payload.trainingConfig || null,
        userDefinedMetadata: payload.userDefinedMetadata || null
    });
    const loaded = await tf.loadLayersModel(handler);
    model = loaded;
    targetModel = buildModel(stateSize, actionSize, config.hiddenLayers, config.learningRate);
    targetModel.setWeights(model.getWeights());
    return true;
};

const buildModel = (inputSize, outputSize, hiddenLayers, learningRate) => {
    const net = tf.sequential();
    const layers = Array.isArray(hiddenLayers) && hiddenLayers.length ? hiddenLayers : [64, 64];
    net.add(tf.layers.dense({
        units: layers[0],
        activation: 'relu',
        inputShape: [inputSize]
    }));
    for (let i = 1; i < layers.length; i += 1) {
        net.add(tf.layers.dense({ units: layers[i], activation: 'relu' }));
    }
    net.add(tf.layers.dense({ units: outputSize }));
    net.compile({
        optimizer: tf.train.adam(learningRate || 0.001),
        loss: 'meanSquaredError'
    });
    return net;
};

const chooseAction = (state) => {
    const rnd = Math.random();
    if (rnd < epsilon) {
        return Math.floor(Math.random() * actionSize);
    }
    return tf.tidy(() => {
        const input = tf.tensor2d([state], [1, stateSize]);
        const qValues = model.predict(input);
        const action = qValues.argMax(-1).dataSync()[0];
        return action;
    });
};

const addReplay = (transition) => {
    if (replay.length < (config.replaySize || 10000)) {
        replay.push(transition);
    } else {
        replay[replayIndex] = transition;
        replayIndex = (replayIndex + 1) % replay.length;
    }
};

const sampleBatch = (batchSize) => {
    const batch = [];
    const max = replay.length;
    for (let i = 0; i < batchSize; i += 1) {
        const idx = Math.floor(Math.random() * max);
        batch.push(replay[idx]);
    }
    return batch;
};

const trainBatch = async () => {
    if (!replay.length) return null;
    const batchSize = Math.min(config.batchSize || 32, replay.length);
    const batch = sampleBatch(batchSize);
    const states = batch.map(item => item.state);
    const nextStates = batch.map(item => item.nextState);
    const actions = batch.map(item => item.action);
    const rewards = batch.map(item => item.reward);
    const dones = batch.map(item => (item.done ? 1 : 0));

    const stateTensor = tf.tensor2d(states, [batchSize, stateSize]);
    const nextStateTensor = tf.tensor2d(nextStates, [batchSize, stateSize]);
    const qTensor = model.predict(stateTensor);
    const qValues = qTensor.arraySync();
    const nextQTensor = targetModel.predict(nextStateTensor).max(1);
    const nextQ = nextQTensor.arraySync();
    for (let i = 0; i < batchSize; i += 1) {
        const target = rewards[i] + (1 - dones[i]) * (config.gamma || 0.95) * nextQ[i];
        qValues[i][actions[i]] = target;
    }
    const targetTensor = tf.tensor2d(qValues, [batchSize, actionSize]);
    const loss = await model.trainOnBatch(stateTensor, targetTensor);
    qTensor.dispose();
    nextQTensor.dispose();
    stateTensor.dispose();
    nextStateTensor.dispose();
    targetTensor.dispose();
    return loss;
};

const maybeSave = async () => {
    if (!config.modelStorageKey) return;
    if (backendUrl) {
        if (config.saveEverySteps && steps % config.saveEverySteps === 0) {
            await saveToBackend();
        }
        if (config.saveEveryEpisodes && episodes > 0 && episodes % config.saveEveryEpisodes === 0) {
            await saveToBackend();
        }
        return;
    }
    if (config.saveEverySteps && steps % config.saveEverySteps === 0) {
        await model.save(`indexeddb://${config.modelStorageKey}`);
    }
    if (config.saveEveryEpisodes && episodes > 0 && episodes % config.saveEveryEpisodes === 0) {
        await model.save(`indexeddb://${config.modelStorageKey}`);
    }
};

self.onmessage = async (event) => {
    const msg = event.data || {};
    try {
        if (msg.type === 'init') {
            config = msg.config || {};
            stateSize = msg.stateSize;
            actionSize = msg.actionSize;
            epsilon = config.epsilon && typeof config.epsilon.start === 'number'
                ? config.epsilon.start
                : 1.0;
            backendUrl = config.backendUrl || '';
            await setupTf(config.tfjsUrl);
            model = buildModel(stateSize, actionSize, config.hiddenLayers, config.learningRate);
            targetModel = buildModel(stateSize, actionSize, config.hiddenLayers, config.learningRate);
            targetModel.setWeights(model.getWeights());
            return;
        }
        if (msg.type === 'load') {
            if (!tf || !config) return;
            if (backendUrl) {
                try {
                    await loadFromBackend();
                } catch (error) {
                    // Ignore if no prior model exists.
                }
                return;
            }
            const key = msg.storageKey || config.modelStorageKey;
            if (!key) return;
            try {
                const loaded = await tf.loadLayersModel(`indexeddb://${key}`);
                model = loaded;
                targetModel = buildModel(stateSize, actionSize, config.hiddenLayers, config.learningRate);
                targetModel.setWeights(model.getWeights());
            } catch (error) {
                // Ignore if no prior model exists.
            }
            return;
        }
        if (msg.type === 'observe') {
            const { id, state, reward, done } = msg;
            if (!model) return;
            const rewardValue = typeof reward === 'number' ? reward : 0;
            const prevS = prevState.get(id);
            const prevA = prevAction.get(id);
            if (prevS && typeof prevA === 'number') {
                addReplay({
                    state: prevS,
                    action: prevA,
                    reward: rewardValue,
                    nextState: state,
                    done: !!done
                });
            }
            const action = chooseAction(state);
            prevState.set(id, state);
            prevAction.set(id, action);
            steps += 1;
            if (config.epsilon && typeof config.epsilon.decay === 'number') {
                epsilon = Math.max(config.epsilon.min || 0.1, epsilon * config.epsilon.decay);
            }
            if (config.trainEvery && steps % config.trainEvery === 0 && replay.length >= (config.batchSize || 32)) {
                const loss = await trainBatch();
                if (Array.isArray(loss)) {
                    lastLoss = loss[0];
                } else {
                    lastLoss = loss;
                }
                self.postMessage({ type: 'train', loss: lastLoss });
            }
            if (config.targetUpdateEvery && steps % config.targetUpdateEvery === 0) {
                targetModel.setWeights(model.getWeights());
            }
            if (done) {
                episodes += 1;
                prevState.delete(id);
                prevAction.delete(id);
            }
            await maybeSave();
            self.postMessage({
                type: 'action',
                id,
                action,
                epsilon,
                steps,
                episodes,
                reward: rewardValue,
                loss: lastLoss
            });
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
    }
};
