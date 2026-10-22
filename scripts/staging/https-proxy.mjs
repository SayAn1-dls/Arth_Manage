// TLS terminator for staging rehearsals, standing in for the reverse proxy a real host provides.
// Usage: node scripts/staging/https-proxy.mjs <listenPort> <upstreamPort> <key.pem> <cert.pem>
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';

const [listen = '8443', upstream = '4020', keyFile, certFile] = process.argv.slice(2);
createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
  const out = httpRequest(
    {
      host: '127.0.0.1',
      port: Number(upstream),
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        'x-forwarded-for': req.socket.remoteAddress ?? '',
        'x-forwarded-proto': 'https',
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  out.on('error', () => {
    res.writeHead(502);
    res.end('upstream unavailable');
  });
  req.pipe(out);
}).listen(Number(listen), () => console.log(`https proxy on ${listen} -> ${upstream}`));
