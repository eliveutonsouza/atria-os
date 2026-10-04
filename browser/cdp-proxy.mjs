// Expõe o CDP do Chromium (127.0.0.1:9222) na rede do compose (0.0.0.0:9223).
// O Chrome recusa Host que não seja IP/localhost, então o proxy reescreve o Host em HTTP e no upgrade WebSocket.
import http from 'node:http';
import net from 'node:net';

const TARGET = { host: '127.0.0.1', port: 9222 };

const server = http.createServer((req, res) => {
  const up = http.request({ ...TARGET, method: req.method, path: req.url, headers: { ...req.headers, host: 'localhost' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    res.writeHead(502);
    res.end('cdp indisponível');
  });
  req.pipe(up);
});

server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET.port, TARGET.host, () => {
    const headers = { ...req.headers, host: 'localhost' };
    delete headers.origin; // Chrome checa Origin no WS; sem Origin não há checagem
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', ''];
    up.write(lines.join('\r\n'));
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const close = () => {
    socket.destroy();
    up.destroy();
  };
  up.on('error', close);
  socket.on('error', close);
});

server.listen(9223, '0.0.0.0', () => console.log('cdp-proxy em :9223'));
