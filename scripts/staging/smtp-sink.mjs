// A throwaway SMTP server for staging rehearsals: accepts mail from the API and appends each message to a
// JSON-lines file so tests can read verification and invitation links. It delivers nothing anywhere.
// Usage: node scripts/staging/smtp-sink.mjs <port> <output.jsonl>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';

const [port = '2525', file = 'mail.jsonl'] = process.argv.slice(2);

const qp = (s) =>
  s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const header = (raw, name) =>
  new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, 'im')
    .exec(raw)?.[1]
    ?.replace(/\r?\n[ \t]/g, ' ') ?? '';
const decodeWords = (s) =>
  s.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, enc, v) =>
    enc.toLowerCase() === 'b'
      ? Buffer.from(v, 'base64').toString('utf8')
      : Buffer.from(qp(v.replace(/_/g, ' ')), 'latin1').toString('utf8'),
  );

createServer((sock) => {
  let data = '';
  let inData = false;
  let to = '';
  const reply = (line) => sock.write(`${line}\r\n`);
  reply('220 smtp-sink ready');
  sock.on('data', (chunk) => {
    data += chunk.toString('latin1');
    if (inData) {
      if (!data.includes('\r\n.\r\n')) return;
      const raw = data.slice(0, data.indexOf('\r\n.\r\n'));
      const [head, ...rest] = raw.split(/\r?\n\r?\n/);
      const body = rest.join('\n\n');
      const encoding = header(head, 'Content-Transfer-Encoding').toLowerCase();
      const text = encoding.includes('quoted')
        ? qp(body)
        : encoding.includes('base64')
          ? Buffer.from(body, 'base64').toString('utf8')
          : body;
      appendFileSync(
        file,
        JSON.stringify({
          to: to.toLowerCase(),
          subject: decodeWords(header(head, 'Subject')),
          text: Buffer.from(text, 'latin1').toString('utf8'),
        }) + '\n',
      );
      data = '';
      inData = false;
      reply('250 queued');
      return;
    }
    let i;
    while ((i = data.indexOf('\r\n')) >= 0) {
      const line = data.slice(0, i);
      data = data.slice(i + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') reply('250 smtp-sink');
      else if (cmd === 'MAIL') reply('250 ok');
      else if (cmd === 'RCPT') {
        to = /<([^>]+)>/.exec(line)?.[1] ?? '';
        reply('250 ok');
      } else if (cmd === 'DATA') {
        reply('354 end with <CRLF>.<CRLF>');
        inData = true;
        if (data.length) sock.emit('data', Buffer.alloc(0));
        break;
      } else if (cmd === 'QUIT') {
        reply('221 bye');
        sock.end();
      } else reply('250 ok');
    }
  });
  sock.on('error', () => undefined);
}).listen(Number(port), '127.0.0.1', () => console.log(`smtp-sink on ${port} -> ${file}`));
