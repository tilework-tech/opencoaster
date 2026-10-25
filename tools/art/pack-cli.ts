import { resolve } from 'node:path';
import { packSprites } from './pack';

const spriteDirectory = resolve('public/sprites');
const renderedDirectory = resolve('tools/sprites/.build');
await packSprites([spriteDirectory, renderedDirectory], spriteDirectory);
