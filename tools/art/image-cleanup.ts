export function defringeRgba(source: Uint8Array, width: number, height: number): Uint8Array {
  if (source.length !== width * height * 4) throw new Error('RGBA buffer dimensions do not match');
  const output = new Uint8Array(source);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = source[offset + 3];
      if (alpha === 0) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        continue;
      }
      if (alpha === 255) continue;
      let nearest = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const candidate = (ny * width + nx) * 4;
          if (source[candidate + 3] < 250) continue;
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
          }
        }
      }
      if (nearest >= 0) {
        output[offset] = source[nearest];
        output[offset + 1] = source[nearest + 1];
        output[offset + 2] = source[nearest + 2];
      }
    }
  }
  return output;
}
