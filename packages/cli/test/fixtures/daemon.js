const fs = require('node:fs');
const http = require('node:http');

const config = JSON.parse(fs.readFileSync(process.env.CONDUIT_CONFIG_PATH, 'utf8'));
const instanceId = process.env.CONDUIT_INSTANCE_ID;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') {
    response.end(JSON.stringify({ status: 'ok', extensionConnected: false, instanceId }));
    return;
  }
  if (request.method === 'POST' && request.url === '/api/shutdown') {
    response.statusCode = 202;
    response.end(JSON.stringify({ stopping: true, instanceId }));
    setImmediate(() => server.close(() => process.exit(0)));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { message: 'Fixture endpoint not found.' } }));
});

server.listen(config.daemon.port, '127.0.0.1', () => {
  process.stdout.write(`fixture daemon ${instanceId}\n`);
});
