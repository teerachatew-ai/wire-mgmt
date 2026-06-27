// localtunnel runner — exposes the local server online with a fixed subdomain.
// Writes the active URL to current-link.txt. Exits on close/error so PM2 restarts it.
const fs = require('fs');
const path = require('path');
const localtunnel = require('localtunnel');

const PORT = 3001;
const SUBDOMAIN = 'wirecut-vsk';   // ขอ subdomain คงที่ (ถ้าโดนใช้แล้วจะได้ random แทน)
const LINK_FILE = path.join(__dirname, 'lt-url.txt');

(async () => {
  try {
    const tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });
    console.log(`[${new Date().toISOString()}] tunnel online: ${tunnel.url}`);
    try { fs.writeFileSync(LINK_FILE, tunnel.url + '\n'); } catch {}

    tunnel.on('close', () => {
      console.log('tunnel closed — exiting for PM2 restart');
      process.exit(1);
    });
    tunnel.on('error', (err) => {
      console.log('tunnel error:', err.message);
      process.exit(1);
    });
  } catch (err) {
    console.log('failed to open tunnel:', err.message);
    process.exit(1);
  }
})();
