import sharp from 'sharp';
const [,, out, cols, tw, th, ...files] = process.argv;
const bufs = await Promise.all(files.map((f) => sharp(f).resize(+tw, +th, { kernel: 'nearest' }).toBuffer()));
const rows = Math.ceil(files.length / +cols);
await sharp({ create: { width: +tw * +cols, height: +th * rows, channels: 3, background: '#000' } })
  .composite(bufs.map((b, i) => ({ input: b, left: (i % +cols) * +tw, top: Math.floor(i / +cols) * +th })))
  .toFile(out);
