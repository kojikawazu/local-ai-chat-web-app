// ブラウザのツール（#149）の E2E で開かせる確認用のページを配る、小さい静的なサーバー。
// playwright.config.ts の webServer が `node <このファイル> <フォルダ> <ポート>` で起動する。
// 127.0.0.1 だけで待ち受け、フォルダの外のファイルは返さない。
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const [root, port] = process.argv.slice(2);
const base = path.resolve(root);

http
  .createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = path.resolve(
      base,
      '.' + (pathname.endsWith('/') ? `${pathname}index.html` : pathname)
    );
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  })
  .listen(Number(port), '127.0.0.1');
