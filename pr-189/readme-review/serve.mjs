// Serves the README review page and writes POST /save bodies to README.edited.md beside it.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4310);
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url?.endsWith('/save')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    await writeFile(join(here, 'README.edited.md'), body);
    res.writeHead(204).end();
    return;
  }
  const page = await readFile(join(here, 'index.html'));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
}).listen(port, '0.0.0.0', () => console.log(`README review on :${port}`));
