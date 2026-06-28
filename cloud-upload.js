// อัปโหลดฐานข้อมูลในเครื่องนี้ขึ้น cloud (Neon) ให้ระบบบน Render ใช้ข้อมูลเดียวกัน
// วิธีใช้: ใส่ DATABASE_URL ของ Neon ลงในไฟล์ cloud-db-url.txt แล้วรัน:  node cloud-upload.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let url = process.argv[2] || process.env.DATABASE_URL || '';
if (!url) {
  try { url = fs.readFileSync(path.join(__dirname, 'cloud-db-url.txt'), 'utf8').trim(); } catch {}
}
if (!url || !url.startsWith('postgres')) {
  console.error('❌ ไม่พบ DATABASE_URL — วาง connection string ของ Neon ลงในไฟล์ cloud-db-url.txt ก่อน');
  process.exit(1);
}

const dbPath = path.join(__dirname, 'data', 'wire-mgmt.db');
if (!fs.existsSync(dbPath)) { console.error('❌ ไม่พบไฟล์ฐานข้อมูล', dbPath); process.exit(1); }
const data = fs.readFileSync(dbPath);

(async () => {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS app_db (id INT PRIMARY KEY, data BYTEA NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query(
    `INSERT INTO app_db (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`, [data]);
  console.log(`✅ อัปโหลดข้อมูลขึ้น cloud สำเร็จ (${(data.length / 1024).toFixed(0)} KB)`);
  console.log('➡️ ขั้นต่อไป: ที่ Render กด Manual Deploy > Deploy latest commit เพื่อให้ระบบโหลดข้อมูลนี้');
  await pool.end();
})().catch(e => { console.error('❌ ผิดพลาด:', e.message); process.exit(1); });
