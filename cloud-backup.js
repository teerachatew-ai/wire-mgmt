// สำรองฐานข้อมูลจาก cloud (Neon) → ไฟล์ในเครื่อง (เก็บลงวันที่ + เก็บย้อนหลัง 60 ไฟล์)
// ใช้ DATABASE_URL จากไฟล์ cloud-db-url.txt  ·  รัน: node cloud-backup.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let url = process.argv[2] || process.env.DATABASE_URL || '';
if (!url) { try { url = fs.readFileSync(path.join(__dirname, 'cloud-db-url.txt'), 'utf8').trim(); } catch {} }
if (!url || !url.startsWith('postgres')) { console.error('❌ ไม่พบ DATABASE_URL (วางใน cloud-db-url.txt)'); process.exit(1); }

// โฟลเดอร์ backup — เก็บใน OneDrive ถ้ามี (จะ sync ขึ้นคลาวด์ Microsoft ด้วย) ไม่งั้นเก็บในโปรเจกต์
const oneDrive = 'D:/OneDrive - PTT GROUP/wire-mgmt-backups';
const backupDir = fs.existsSync('D:/OneDrive - PTT GROUP') ? oneDrive : path.join(__dirname, 'cloud-backups');
fs.mkdirSync(backupDir, { recursive: true });

(async () => {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const r = await pool.query('SELECT data, updated_at FROM app_db WHERE id = 1');
  await pool.end();
  if (!r.rows[0]) { console.error('❌ ไม่พบข้อมูลใน cloud'); process.exit(1); }
  const data = r.rows[0].data;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const out = path.join(backupDir, `wire-mgmt-${stamp}.db`);
  fs.writeFileSync(out, data);
  // prune เก็บ 60 ไฟล์ล่าสุด
  const files = fs.readdirSync(backupDir).filter(f => f.startsWith('wire-mgmt-') && f.endsWith('.db')).sort();
  while (files.length > 60) { const old = files.shift(); try { fs.unlinkSync(path.join(backupDir, old)); } catch {} }
  console.log(`✅ สำรองข้อมูลสำเร็จ (${(data.length / 1024).toFixed(0)} KB)`);
  console.log(`   ไฟล์: ${out}`);
  console.log(`   เก็บย้อนหลัง: ${Math.min(files.length + 1, 60)} ชุด ที่ ${backupDir}`);
})().catch(e => { console.error('❌ ผิดพลาด:', e.message); process.exit(1); });
