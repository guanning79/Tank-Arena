/**
 * FX Manager
 * Handles effect rendering and audio playback.
 */
class FxManager {
    constructor(ctx) {
        this.ctx = ctx;
        this.config = null;
        this.configPromise = null;
        this.textureCache = {};
        this.audioCache = {};
        this.globalFx = [];
        this.pendingRequests = [];
        this.volume = 1;
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
        if (this.audioCache[soundPath]) {
            return this.audioCache[soundPath];
        }
        const audio = new Audio(soundPath);
        audio.volume = this.volume;
        this.audioCache[soundPath] = audio;
        return audio;
    }

    setVolume(volume) {
        const next = typeof volume === 'number' ? volume : 1;
        this.volume = Math.max(0, Math.min(1, next));
        Object.values(this.audioCache).forEach((audio) => {
            audio.volume = this.volume;
        });
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
        const audio = soundPath ? this.ensureAudio(soundPath) : null;
        return new FxInstance(name, x, y, config, image, audio, soundStartFrame);
    }

    updateList(list) {
        if (!Array.isArray(list) || !list.length) return;
        for (let i = list.length - 1; i >= 0; i -= 1) {
            const fx = list[i];
            fx.update();
            if (fx.state === 'ended') {
                list.splice(i, 1);
            }
        }
    }

    drawList(list) {
        if (!Array.isArray(list) || !list.length) return;
        list.forEach((fx) => fx.draw(this.ctx));
    }

    updateGlobal() {
        this.updateList(this.globalFx);
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
    constructor(name, x, y, config, image, audio, soundStartFrame) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.config = config;
        this.image = image;
        this.audio = audio;
        this.soundStartFrame = soundStartFrame;
        this.soundPlayed = false;
        this.frameIndex = 0;
        this.state = 'start';
        this.loop = !!config.loop;
    }

    update() {
        if (this.state === 'ended') return;
        if (this.state === 'start') {
            this.state = 'playing';
        }
        if (!this.soundPlayed && this.audio && this.frameIndex >= this.soundStartFrame) {
            this.soundPlayed = true;
            try {
                this.audio.currentTime = 0;
                if (this.loop && !this.image) {
                    this.audio.loop = true;
                } else {
                    this.audio.loop = false;
                }
                this.audio.play();
            } catch (error) {
                // Ignore audio playback errors (autoplay restrictions)
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
        if (this.audio) {
            try {
                this.audio.loop = false;
                this.audio.pause();
                this.audio.currentTime = 0;
            } catch (error) {
                // Ignore audio playback errors
            }
        }
        this.state = 'ended';
    }
}
