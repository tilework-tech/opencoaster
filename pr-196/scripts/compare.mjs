import sharp from 'sharp';
// Mean absolute RGB difference between two same-sized PNGs (0 = identical).
const [a, b] = process.argv.slice(2);
const [x, y] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
if (x.info.width !== y.info.width || x.info.height !== y.info.height) { console.log('size differs'); process.exit(); }
let sum = 0;
for (let i = 0; i < x.data.length; i++) sum += Math.abs(x.data[i] - y.data[i]);
console.log((sum / x.data.length).toFixed(2));
