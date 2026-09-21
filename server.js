// Minimaler statischer Server ohne Abhängigkeiten: node server.js  ->  http://localhost:5180
//
// Umgebungsvariablen:
//   PORT       Port (Standard 5180)
//   HOST       Bind-Adresse (Standard 0.0.0.0)
//   MUSIC_DIR  Ordner mit Songs (Standard ./music) – wird unter /music/… ausgeliefert
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const MUSIC = path.resolve(process.env.MUSIC_DIR || path.join(__dirname, 'music'));
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '0.0.0.0';
const AUDIO_EXT = ['.mp3', '.ogg', '.wav', '.m4a', '.flac'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function listSongs() {
  if (!fs.existsSync(MUSIC)) return [];
  return fs.readdirSync(MUSIC)
    .filter(f => AUDIO_EXT.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map(f => ({ name: path.parse(f).name, url: 'music/' + encodeURIComponent(f) }));
}

// Datei nur ausliefern, wenn sie wirklich unterhalb des erlaubten Ordners liegt
function resolveInside(base, rel) {
  const file = path.resolve(base, '.' + path.sep + rel);
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { return send(res, 400, 'Bad Request'); }

  if (url === '/api/songs') return send(res, 200, JSON.stringify(listSongs()), TYPES['.json']);
  if (url === '/healthz') return send(res, 200, 'ok');

  const file = url.startsWith('/music/')
    ? resolveInside(MUSIC, url.slice('/music/'.length))
    : resolveInside(PUBLIC, url === '/' ? 'index.html' : url.slice(1));
  if (!file) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Hypersense läuft auf http://localhost:${PORT} (Songs aus ${MUSIC}, ${listSongs().length} gefunden)`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
