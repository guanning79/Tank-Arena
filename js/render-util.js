/**
 * Render utilities
 */
function createAlphaMaskedImage(img, threshold) {
    const safeThreshold = typeof threshold === 'number' ? threshold : 12;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r <= safeThreshold && g <= safeThreshold && b <= safeThreshold) {
            data[i + 3] = 0;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}
