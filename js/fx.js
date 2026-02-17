/**
 * FX Manager
 * Handles effect rendering and audio playback.
 * Audio: load in worker, decode on main, cache AudioBuffer; play only when ready with optional start offset.
 */
class FxManager {
    constructor(ctx, options) {
        this.ctx = ctx;
        this.config = null;
        this.configPromise = null;
        this.textureCache = {};
        this.audioCache = {};
        this.globalFx = [];
        this.pendingRequests = [];
        this.volume = 1;
        this.fixedTimeStepMs = (options && typeof options.fixedTimeStepMs === 'number') ? options.fixedTimeStepMs : 33;
        this.audioContext = null;
        this.audioWorker = typeof Worker !== 'undefined' ? new Worker('js/audio-worker.js') : null;
        if (this.audioWorker) {
            this.audioWorker.onmessage = (event) => this._onAudioWorkerMessage(event.data);
            this.audioWorker.onerror = () => {
                console.error('Audio worker error');
            };
        }
    }

    _getAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.audioContext;
    }

    resumeAudioContext() {
        const context = this._getAudioContext();
        if (context.state === 'suspended') {
            context.resume();
        }
    }

    _decodeAndStore(url, arrayBuffer) {
        const cache = this.audioCache;
        const entry = cache[url];
        if (!entry) return;
        const context = this._getAudioContext();
        context.decodeAudioData(arrayBuffer)
            .then((buffer) => {
                if (cache[url]) {
                    cache[url].buffer = buffer;
                    cache[url].ready = true;
                }
            })
            .catch((err) => {
                console.error('Audio decode failed for ' + url + ': ', err);
                delete cache[url];
            });
    }

    _onAudioWorkerMessage(data) {
        if (!data) return;
        if (data.type === 'buffer' && data.url && data.arrayBuffer) {
            this._decodeAndStore(data.url, data.arrayBuffer);
            return;
        }
        if (data.type === 'error' && data.url) {
            console.error('Audio load failed for ' + data.url + ': ' + (data.message || 'Unknown error'));
            delete this.audioCache[data.url];
        }
    }

    loadConfig() {
        if (this.configPromise) return this.configPromise;
        this.configPromise = fetch('fx/effects.json', { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load fx/effects.json: ${response.statusText}`);
                }
                return response.json();
            })
            .then((data) => {
                this.config = data || {};
                if (this.pendingRequests.length) {
                    const pending = [...this.pendingRequests];
                    this.pendingRequests = [];
                    pending.forEach((request) => {
                        this.requestFx(
                            request.name,
                            request.x,
                            request.y,
                            request.list,
                            request.onAdded
                        );
                    });
                }
                return this.config;
            })
            .catch((error) => {
                console.error('Failed to load effects config:', error);
                this.config = {};
                return this.config;
            });
        return this.configPromise;
    }

    preloadFx(name) {
        return this.loadConfig().then(() => {
            const config = this.config ? this.config[name] : null;
            if (!config) return;
            if (config.texture) {
                this.ensureTexture(config.texture);
            }
            if (config.sound) {
                this.ensureAudio(config.sound);
            }
        });
    }

    ensureTexture(texturePath) {
        if (this.textureCache[texturePath]) {
            return this.textureCache[texturePath];
        }
        const img = new Image();
        const isGif = /\.gif(\?|#|$)/i.test(texturePath);
        const entry = { img, processed: null, isGif };
        img.onload = () => {
            if (!entry.isGif) {
                entry.processed = createAlphaMaskedImage(img, 12);
            }
        };
        img.src = texturePath;
        this.textureCache[texturePath] = entry;
        return entry;
    }

    ensureAudio(soundPath) {
        const base = typeof document !== 'undefined' && document.baseURI
            ? document.baseURI
            : (typeof window !== 'undefined' ? window.location.href : '');
        const absoluteUrl = base ? new URL(soundPath, base).href : soundPath;
        const cache = this.audioCache;
        const entry = cache[absoluteUrl];
        if (entry) {
            return entry;
        }
        cache[absoluteUrl] = { ready: false };
        if (this.audioWorker) {
            this.audioWorker.postMessage({ type: 'load', url: absoluteUrl });
        } else {
            fetch(absoluteUrl, { cache: 'default' })
                .then((response) => {
                    if (!response.ok) throw new Error(response.statusText);
                    return response.arrayBuffer();
                })
                .then((arrayBuffer) => this._decodeAndStore(absoluteUrl, arrayBuffer))
                .catch((err) => {
                    console.error('Audio load failed for ' + absoluteUrl + ': ', err);
                    delete cache[absoluteUrl];
                });
        }
        return cache[absoluteUrl];
    }

    setVolume(volume) {
        const next = typeof volume === 'number' ? volume : 1;
        this.volume = Math.max(0, Math.min(1, next));
    }

    playBuffer(entry, startOffsetSeconds, loop) {
        if (!entry || !entry.ready || !entry.buffer) return null;
        this.resumeAudioContext();
        const context = this._getAudioContext();
        const source = context.createBufferSource();
        source.buffer = entry.buffer;
        source.loop = !!loop;
        const gain = context.createGain();
        gain.gain.value = this.volume;
        source.connect(gain);
        gain.connect(context.destination);
        const duration = entry.buffer.duration;
        const offset = Math.max(0, Math.min(startOffsetSeconds, duration - 0.001));
        source.start(context.currentTime, offset);
        return loop ? source : null;
    }

    playFx(name, x, y) {
        this.requestFx(name, x, y, this.globalFx);
    }

    requestFx(name, x, y, list, onAdded = null) {
        if (!this.config) {
            this.pendingRequests.push({ name, x, y, list, onAdded });
            this.loadConfig();
            return;
        }
        const config = this.config[name];
        if (!config) return;
        if (config.unique && Array.isArray(list)) {
            const hasActive = list.some((fx) => fx.name === name && fx.state !== 'ended');
            if (hasActive) return;
        }
        const instance = this.createInstance(name, x, y, config);
        if (!instance || !Array.isArray(list)) return;
        list.push(instance);
        if (onAdded) onAdded();
    }

    createInstance(name, x, y, config) {
        if (!config) return null;
        const texturePath = config.texture || '';
        const image = texturePath ? this.ensureTexture(texturePath) : null;
        const soundPath = config.sound || '';
        const soundStartFrame = typeof config.soundStartFrame === 'number' ? config.soundStartFrame : 0;
        const audioEntry = soundPath ? this.ensureAudio(soundPath) : null;
        return new FxInstance(name, x, y, config, image, audioEntry, soundStartFrame, this);
    }

    updateList(list, gameTick) {
        if (!Array.isArray(list) || !list.length) return;
        const tick = typeof gameTick === 'number' ? gameTick : 0;
        for (let i = list.length - 1; i >= 0; i -= 1) {
            const fx = list[i];
            fx.update(tick);
            if (fx.state === 'ended') {
                list.splice(i, 1);
            }
        }
    }

    drawList(list) {
        if (!Array.isArray(list) || !list.length) return;
        list.forEach((fx) => fx.draw(this.ctx));
    }

    updateGlobal(gameTick) {
        this.updateList(this.globalFx, gameTick);
    }

    drawGlobal() {
        this.drawList(this.globalFx);
    }

    hasActiveFx(name, list = null) {
        const source = Array.isArray(list) ? list : this.globalFx;
        return source.some((fx) => fx.name === name && fx.state !== 'ended');
    }

}

class FxInstance {
    constructor(name, x, y, config, image, audioEntry, soundStartFrame, fxManager) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.config = config;
        this.image = image;
        this.audioEntry = audioEntry;
        this.soundStartFrame = soundStartFrame;
        this.fxManager = fxManager;
        this.soundPlayed = false;
        this.requestedPlayAtGameTick = null;
        this.playingSourceNode = null;
        this.frameIndex = 0;
        this.state = 'start';
        this.loop = !!config.loop;
    }

    update(gameTick) {
        if (this.state === 'ended') return;
        if (this.state === 'start') {
            this.state = 'playing';
        }
        if (!this.soundPlayed && this.frameIndex >= this.soundStartFrame) {
            if (!this.audioEntry) {
                this.soundPlayed = true;
            } else if (!this.audioEntry.ready) {
                if (this.requestedPlayAtGameTick === null) {
                    this.requestedPlayAtGameTick = typeof gameTick === 'number' ? gameTick : 0;
                }
            } else {
                this.soundPlayed = true;
                const ms = this.fxManager.fixedTimeStepMs || 33;
                let offsetSec = 0;
                if (this.requestedPlayAtGameTick !== null && typeof gameTick === 'number') {
                    offsetSec = (gameTick - this.requestedPlayAtGameTick) * (ms / 1000);
                }
                this.playingSourceNode = this.fxManager.playBuffer(
                    this.audioEntry,
                    Math.max(0, offsetSec),
                    this.loop && !this.image
                );
            }
        }
        const frameCount = this.config.frameCount || 0;
        if (!this.loop) {
            if (!frameCount || this.frameIndex >= frameCount) {
                this.state = 'ended';
                return;
            }
            this.frameIndex += 1;
            if (this.frameIndex >= frameCount) {
                this.state = 'ended';
            }
            return;
        }
        if (frameCount) {
            this.frameIndex += 1;
            if (this.frameIndex >= frameCount) {
                this.frameIndex = 0;
            }
        }
    }

    draw(ctx) {
        if (this.state !== 'playing') return;
        const frameCount = this.config.frameCount || 0;
        if (!frameCount || this.frameIndex >= frameCount) return;
        if (!this.image || !this.image.img || !this.image.img.complete) return;
        const scaleByFrame = Array.isArray(this.config.scaleByFrame)
            ? this.config.scaleByFrame
            : null;
        const scale = scaleByFrame
            ? (scaleByFrame[this.frameIndex] ?? scaleByFrame[scaleByFrame.length - 1] ?? 1)
            : 1;
        const sourceImage = this.image.isGif ? this.image.img : (this.image.processed || this.image.img);
        const offset = this.config.pixel_offset || null;
        const size = this.config.pixel_size || null;
        let sx = 0;
        let sy = 0;
        let sw = sourceImage.width;
        let sh = sourceImage.height;
        if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
            sx = Math.max(0, Math.floor(offset.x));
            sy = Math.max(0, Math.floor(offset.y));
        }
        if (size && typeof size.x === 'number' && typeof size.y === 'number') {
            sw = Math.max(1, Math.floor(size.x));
            sh = Math.max(1, Math.floor(size.y));
        } else if (sx || sy) {
            sw = Math.max(1, sourceImage.width - sx);
            sh = Math.max(1, sourceImage.height - sy);
        }
        if (sx + sw > sourceImage.width) {
            sw = Math.max(1, sourceImage.width - sx);
        }
        if (sy + sh > sourceImage.height) {
            sh = Math.max(1, sourceImage.height - sy);
        }
        const width = sw * scale;
        const height = sh * scale;
        const x = this.x - width / 2;
        const y = this.y - height / 2;
        ctx.drawImage(sourceImage, sx, sy, sw, sh, x, y, width, height);
    }

    stop() {
        if (this.playingSourceNode) {
            try {
                this.playingSourceNode.stop();
            } catch (e) {
                // Already stopped or detached
            }
            this.playingSourceNode = null;
        }
        this.state = 'ended';
    }
}
