/**
 * Audio worker: fetches audio URLs and posts ArrayBuffer to main thread.
 * Main thread is responsible for decodeAudioData and playback.
 */
self.onmessage = function (event) {
    const data = event.data;
    if (!data || data.type !== 'load' || typeof data.url !== 'string') return;
    const url = data.url;
    fetch(url)
        .then(function (response) {
            if (!response.ok) {
                throw new Error('Fetch failed: ' + response.statusText);
            }
            return response.arrayBuffer();
        })
        .then(function (arrayBuffer) {
            self.postMessage({ type: 'buffer', url: url, arrayBuffer: arrayBuffer }, [arrayBuffer]);
        })
        .catch(function (err) {
            self.postMessage({
                type: 'error',
                url: url,
                message: err && (err.message || String(err)) || 'Unknown error'
            });
        });
};
