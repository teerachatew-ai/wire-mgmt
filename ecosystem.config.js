module.exports = {
  apps: [
    {
      name: 'wire-backend',
      script: 'dist/server/index.js',
      cwd: 'D:/Claude Code/wire-mgmt',
      restart_delay: 2000,
      max_restarts: 999,
      autorestart: true,
      max_memory_restart: '300M',
    },
    {
      name: 'wire-tunnel',
      script: 'ngrok.exe',
      cwd: 'D:/Claude Code/wire-mgmt',
      // URL ถาวร (โดเมนฟรีของบัญชี) — authtoken อยู่ใน ngrok.yml แล้ว
      args: 'http 3001 --url https://degrease-emission-perjury.ngrok-free.dev --log stdout --log-format logfmt',
      interpreter: 'none',
      restart_delay: 5000,
      max_restarts: 999,
      autorestart: true,
    },
    {
      name: 'wire-watchdog',
      script: 'watchdog.js',
      cwd: 'D:/Claude Code/wire-mgmt',
      restart_delay: 10000,
      max_restarts: 999,
      autorestart: true,
    }
  ]
};
