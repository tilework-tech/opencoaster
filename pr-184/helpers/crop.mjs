import sharp from 'sharp';
const [,, src, out, x, y, w, h, scale] = process.argv;
await sharp(src).extract({left:+x, top:+y, width:+w, height:+h}).resize({width: +w * +scale, kernel: 'nearest'}).toFile(out);
