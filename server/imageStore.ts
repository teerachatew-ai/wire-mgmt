// ที่เก็บไฟล์รูป (รูปงาน NG จากไลน์) — แยกจากฐานข้อมูลหลัก เพราะฐานหลักถูกเขียนทับทั้งก้อนทุกครั้งที่บันทึก
//  - cloud (มี DATABASE_URL): ตาราง line_images ใน Postgres (Neon) ตารางละแถวต่อรูป เขียนทีละรูป ไม่แตะฐานหลัก
//  - local: ไฟล์ใน data/line-images/
import fs from 'fs';
import path from 'path';
import { getPgPool } from './db';

const LOCAL_DIR = path.join(process.cwd(), 'data', 'line-images');
let pgReady = false;

async function pg() {
  const pool = getPgPool();
  if (!pool) return null;
  if (!pgReady) {
    await pool.query(`CREATE TABLE IF NOT EXISTS line_images (
      key TEXT PRIMARY KEY, data BYTEA NOT NULL, mime TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
    pgReady = true;
  }
  return pool;
}

const safe = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '');

export async function putImage(key: string, data: Buffer, mime = 'image/jpeg'): Promise<void> {
  const pool = await pg();
  if (pool) {
    await pool.query(
      `INSERT INTO line_images (key, data, mime) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, mime = EXCLUDED.mime`, [key, data, mime]);
    return;
  }
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, safe(key) + '.jpg'), data);
}

export async function getImage(key: string): Promise<{ data: Buffer; mime: string } | null> {
  const pool = await pg();
  if (pool) {
    const r = await pool.query(`SELECT data, mime FROM line_images WHERE key = $1`, [key]);
    return r.rows[0] ? { data: r.rows[0].data, mime: r.rows[0].mime } : null;
  }
  const f = path.join(LOCAL_DIR, safe(key) + '.jpg');
  return fs.existsSync(f) ? { data: fs.readFileSync(f), mime: 'image/jpeg' } : null;
}
