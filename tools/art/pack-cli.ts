import { resolve } from 'node:path';
import { packSprites } from './pack';

const spriteDirectory = resolve('public/sprites');
await packSprites(spriteDirectory, spriteDirectory);
