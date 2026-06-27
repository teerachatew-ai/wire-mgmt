// Watchdog: keeps the ngrok tunnel alive. URL is FIXED (ไม่เปลี่ยน) so no churn.
// - Pings backend + the public ngrok URL; restarts ngrok if down (with cooldown)
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

const FIXED_URL = 'https://degrease-emission-perjury.ngrok-free.dev';
const LINK_FILE = path.join(__dirname, 'current-link.txt');
const PM2 = 'C:\\Users\\ngd58004\\AppData\\Roaming\\npm\\pm2.cmd';

const CHECK_INTERVAL = 30000;     // 30s
const FAIL_LIMIT = 3;             // restart after ~90s down
const RESTART_COOLDOWN = 120000;  // at most 1 restart / 2 min
let fails = 0, lastRestart = 0;

try { fs.writeFileSync(LINK_FILE, FIXED_URL + '\n'); } catch {}

function ping(url, headers) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 12000, headers: headers || {} }, (res) => {
      res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function pingLocal() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3001', { timeout: 5000 }, (res) => {
      res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function restartTunnel() {
  const now = Date.now();
  if (now - lastRestart < RESTART_COOLDOWN) return;
  lastRestart = now;
  console.log(`[${new Date().toISOString()}] ngrok หลุด — รีสตาร์ท`);
  exec(`"${PM2}" restart wire-tunnel`, () => {});
  fails = 0;
}

async function tick() {
  if (!(await pingLocal())) {
    console.log(`[${new Date().toISOString()}] backend ไม่ตอบ (PM2 จะรีสตาร์ทเอง)`);
    return;
  }
  // ngrok-skip-browser-warning: ข้ามหน้าเตือนตอน health-check
  const ok = await ping(FIXED_URL, { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'wire-monitor' });
  if (ok) {
    if (fails > 0) console.log(`[${new Date().toISOString()}] กลับมาออนไลน์: ${FIXED_URL}`);
    fails = 0;
  } else {
    fails++;
    console.log(`[${new Date().toISOString()}] ping ล้มเหลว (${fails}/${FAIL_LIMIT})`);
    if (fails >= FAIL_LIMIT) restartTunnel();
  }
}

console.log('wire-watchdog (ngrok) เริ่มทำงาน — URL: ' + FIXED_URL);
setInterval(tick, CHECK_INTERVAL);
tick();
