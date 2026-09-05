import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import initSqlJs, { Database } from 'sql.js';
import { computePayCycle, loadCutoffConfig } from './payCycle';

// โทเคนสุ่มสำหรับลิงก์พอร์ทัลสมาชิก — เดายาก ไม่มีรูปแบบให้ไล่เดา (ไม่ใช่รหัสสมาชิกที่เรียงลำดับได้)
export function randomToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

// โหมดเก็บข้อมูล:
//  - มี DATABASE_URL (เช่นบน cloud/Render) -> เก็บฐานข้อมูลเป็น blob ใน Postgres (Neon) ให้ถาวร
//  - ไม่มี (เครื่อง local) -> เก็บเป็นไฟล์เหมือนเดิม + สำรองรายวัน
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_PG = !!DATABASE_URL;

const DB_PATH = path.join(process.cwd(), 'data', 'wire-mgmt.db');
const dataDir = path.dirname(DB_PATH);
const backupDir = path.join(dataDir, 'backups');
if (!USE_PG) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
}

let db: Database;

// ---- Postgres blob persistence (cloud) ----
let pgPool: any = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;
let dirty = false;

// ฐานข้อมูลถูกเก็บเป็น blob ก้อนเดียว (เขียนทับทั้งก้อนทุกครั้ง) — ถ้ามี 2 instance รันพร้อมกัน
// ด้วย DATABASE_URL เดียวกัน ต่างคนต่างถือสำเนาในหน่วยความจำของตัวเอง แล้วเขียนทับกัน = ข้อมูลหายทั้งฐาน
// กันด้วยเลข generation: จะเขียนได้ก็ต่อเมื่อ gen ในฐานยังตรงกับที่ instance นี้เขียน/โหลดไว้ล่าสุด
// ถ้าไม่ตรง (มีอีก instance เขียนแทรก) จะ "หยุดเขียน" แล้วแจ้ง error แทนการทับข้อมูลของอีกฝั่งทิ้ง
let myGen = 0;
let genConflict = false;

async function pgInit() {
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgPool.query(`CREATE TABLE IF NOT EXISTS app_db (id INT PRIMARY KEY, data BYTEA NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
  await pgPool.query(`ALTER TABLE app_db ADD COLUMN IF NOT EXISTS gen BIGINT NOT NULL DEFAULT 0`);
}
async function pgLoad(): Promise<Buffer | null> {
  const r = await pgPool.query('SELECT data, gen FROM app_db WHERE id = 1');
  myGen = Number(r.rows[0]?.gen ?? 0);
  return r.rows[0]?.data ?? null;
}
async function pgFlush() {
  if (!pgPool || flushing || !dirty || genConflict) return;
  flushing = true; dirty = false;
  try {
    const data = Buffer.from(db.export());
    const upd = await pgPool.query(
      `UPDATE app_db SET data = $1, gen = gen + 1, updated_at = now() WHERE id = 1 AND gen = $2`,
      [data, myGen]);
    if (upd.rowCount === 1) {
      myGen++;
    } else {
      // ไม่มีแถว = ฐานใหม่ (ยังไม่เคยเขียน) -> สร้างแถวแรก; ถ้าแทรกไม่ได้แปลว่ามีแถวอยู่แต่ gen ไม่ตรง = ชนกัน
      const ins = await pgPool.query(
        `INSERT INTO app_db (id, data, gen, updated_at) VALUES (1, $1, 1, now()) ON CONFLICT (id) DO NOTHING`,
        [data]);
      if (ins.rowCount === 1) {
        myGen = 1;
      } else {
        genConflict = true;
        console.error(
          '🛑 หยุดบันทึกลงฐานข้อมูลกลาง: ตรวจพบว่ามีระบบอีกชุดเขียนข้อมูลชุดเดียวกันอยู่ ' +
          '(ห้ามรัน 2 โฮสต์พร้อมกันด้วย DATABASE_URL เดียวกัน) — ' +
          'ข้อมูลของอีกฝั่งถูกรักษาไว้ ส่วนที่กรอกในเครื่องนี้ยังอยู่ในหน่วยความจำแต่ยังไม่ถูกบันทึก');
      }
    }
  } catch (e) {
    dirty = true; // ลองใหม่รอบถัดไป
    console.error('pgFlush error:', (e as any)?.message);
  } finally { flushing = false; }
}
// ให้ส่วนอื่นเช็คได้ว่าตอนนี้ยังบันทึกลงฐานกลางได้อยู่ไหม
export function dbWriteBlocked() { return genConflict; }
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; pgFlush(); }, 1500);
}
// flush ค้างก่อนปิดโปรเซส (Render ส่ง SIGTERM ตอน deploy/restart)
// flush เฉพาะเมื่อมีการแก้ข้อมูลจริง (dirty) — กันไม่ให้เขียนทับฐานข้อมูลด้วยข้อมูลเปล่าตอน restart
export async function flushNow() { if (USE_PG) await pgFlush(); }

// Save DB after writes
function save() {
  if (USE_PG) { scheduleFlush(); return; }
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// สำรองข้อมูลรายวัน (เก็บย้อนหลัง 30 ไฟล์)
function backupDaily() {
  if (USE_PG) return; // cloud ใช้ Postgres เก็บถาวรอยู่แล้ว ไม่ต้องสำรองไฟล์
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const today = new Date().toISOString().split('T')[0];
    const dest = path.join(backupDir, `wire-mgmt-${today}.db`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(DB_PATH, dest);
      // prune: เก็บ 30 ไฟล์ล่าสุด
      const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort();
      while (files.length > 30) {
        const old = files.shift();
        if (old) try { fs.unlinkSync(path.join(backupDir, old)); } catch {}
      }
    }
  } catch (e) { /* เงียบไว้ ไม่ให้กระทบระบบหลัก */ }
}

// Wrapper that mimics better-sqlite3 sync API
function prepare(sql: string) {
  return {
    run(...params: any[]) {
      db.run(sql, params);
      // ต้องอ่าน last_insert_rowid() ก่อนเรียก save() เสมอ — db.export() ที่อยู่ใน save()
      // ทำให้ค่า last_insert_rowid() ของ connection ถูกรีเซ็ตเป็น 0 ถ้าอ่านหลัง save()
      const [[lastId]] = db.exec('SELECT last_insert_rowid()')[0]?.values || [[0]];
      save();
      return { lastInsertRowid: lastId as number };
    },
    get(...params: any[]) {
      const res = db.exec(sql, params);
      if (!res[0]) return undefined;
      const { columns, values } = res[0];
      if (!values[0]) return undefined;
      return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
    },
    all(...params: any[]) {
      const res = db.exec(sql, params);
      if (!res[0]) return [];
      const { columns, values } = res[0];
      return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    }
  };
}

function exec(sql: string) {
  db.exec(sql);
  save();
}

export async function initDb() {
  const SQL = await initSqlJs();
  let initial: Buffer | null = null;
  if (USE_PG) {
    await pgInit();
    initial = await pgLoad();
    console.log(initial ? '📦 โหลดฐานข้อมูลจาก Postgres (Neon)' : '📦 เริ่มฐานข้อมูลใหม่บน Postgres');
  } else if (fs.existsSync(DB_PATH)) {
    initial = fs.readFileSync(DB_PATH);
  }
  db = initial ? new SQL.Database(initial) : new SQL.Database();

  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  id_card TEXT,
  phone TEXT,
  address TEXT,
  bank_account TEXT,
  bank_name TEXT,
  registered_at TEXT DEFAULT (date('now')),
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  wage_per_unit REAL NOT NULL DEFAULT 0,
  defect_tolerance REAL NOT NULL DEFAULT 5.0,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS receives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  received_at TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  factory_ref TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  issued_at TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  issue_id INTEGER NOT NULL,
  returned_at TEXT NOT NULL,
  good_qty REAL NOT NULL DEFAULT 0,
  defect_qty REAL NOT NULL DEFAULT 0,
  waste_qty REAL NOT NULL DEFAULT 0,
  inspector TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  shipped_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shipment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  good_qty REAL NOT NULL DEFAULT 0,
  defect_qty REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  compensation_type TEXT NOT NULL DEFAULT 'fixed',
  amount REAL NOT NULL DEFAULT 0,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
`);
  save();

  // ── migrations (add columns to existing tables) ──
  const memberCols = db.exec(`PRAGMA table_info(members)`)[0]?.values.map(r => r[1]) ?? [];
  if (!memberCols.includes('nickname')) {
    db.exec(`ALTER TABLE members ADD COLUMN nickname TEXT`);
  }
  if (!memberCols.includes('pdpa_consent')) {
    db.exec(`ALTER TABLE members ADD COLUMN pdpa_consent INTEGER DEFAULT 0`);
  }
  if (!memberCols.includes('pdpa_consent_at')) {
    db.exec(`ALTER TABLE members ADD COLUMN pdpa_consent_at TEXT`);
  }
  if (!memberCols.includes('dob')) {
    db.exec(`ALTER TABLE members ADD COLUMN dob TEXT`);
  }
  if (!memberCols.includes('id_card_photo')) {
    // เก็บเป็น data URL (base64) รูปย่อขนาดเล็กของบัตรประชาชน — ไม่ใช่รูปต้นฉบับขนาดเต็ม
    db.exec(`ALTER TABLE members ADD COLUMN id_card_photo TEXT`);
  }
  if (!memberCols.includes('portal_token')) {
    // โทเคนสุ่ม ไม่ซ้ำ ใช้เป็นลิงก์/QR ส่วนตัวของสมาชิกแต่ละคน (เดาไม่ได้ ไม่ต้อง login)
    db.exec(`ALTER TABLE members ADD COLUMN portal_token TEXT`);
    const noToken = db.exec(`SELECT id FROM members WHERE portal_token IS NULL OR portal_token = ''`)[0]?.values ?? [];
    for (const [id] of noToken) {
      db.run(`UPDATE members SET portal_token = ? WHERE id = ?`, [randomToken(), id]);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_portal_token ON members(portal_token)`);
  }
  const productCols = db.exec(`PRAGMA table_info(products)`)[0]?.values.map(r => r[1]) ?? [];
  if (!productCols.includes('factory_price')) {
    db.exec(`ALTER TABLE products ADD COLUMN factory_price REAL NOT NULL DEFAULT 0`);
  }
  if (!productCols.includes('project')) {
    db.exec(`ALTER TABLE products ADD COLUMN project TEXT`);
  }
  if (!productCols.includes('color')) {
    db.exec(`ALTER TABLE products ADD COLUMN color TEXT`);
  }
  if (!productCols.includes('description')) {
    db.exec(`ALTER TABLE products ADD COLUMN description TEXT`);
  }
  if (!productCols.includes('units_per_box')) {
    // มาตรฐานบรรจุ (จำนวน/ลัง) ต่อรุ่นสินค้า — ใช้คำนวณจำนวนลังตอนวางแผนจัดลังส่งงาน
    db.exec(`ALTER TABLE products ADD COLUMN units_per_box REAL`);
  }
  const shipItemCols = db.exec(`PRAGMA table_info(shipment_items)`)[0]?.values.map(r => r[1]) ?? [];
  if (!shipItemCols.includes('received_qty')) {
    // ยอดที่โรงงานรับจริง (NULL = ยังไม่ยืนยัน) — ใช้คิดเงินแทน good_qty เมื่อกรอกแล้ว
    db.exec(`ALTER TABLE shipment_items ADD COLUMN received_qty REAL`);
  }

  // บันทึกว่าผู้ใช้ (admin) คนไหนเป็นคนกรอกแต่ละรายการ
  for (const t of ['receives', 'issues', 'returns', 'shipments']) {
    const cols = db.exec(`PRAGMA table_info(${t})`)[0]?.values.map(r => r[1]) ?? [];
    if (!cols.includes('created_by')) db.exec(`ALTER TABLE ${t} ADD COLUMN created_by TEXT`);
  }

  // คำขอคืนงานที่สมาชิกส่งเองผ่านลิงก์พอร์ทัลส่วนตัว — ยังไม่ใช่ยอดจริง ต้องรอเจ้าหน้าที่ตรวจนับของจริงแล้วกดยืนยันก่อน
  // ถึงจะกลายเป็นแถวใน returns (กันสมาชิกปลอมยอดเบิกเอง — เจ้าหน้าที่เห็น "ยอดที่แจ้ง" แต่กรอกยอดจริงตอนยืนยันได้)
  db.exec(`CREATE TABLE IF NOT EXISTS return_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    good_qty REAL NOT NULL DEFAULT 0,
    ng_cut REAL NOT NULL DEFAULT 0,
    ng_factory REAL NOT NULL DEFAULT 0,
    waste_qty REAL NOT NULL DEFAULT 0,
    lost_qty REAL NOT NULL DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT DEFAULT (datetime('now')),
    confirmed_return_id INTEGER,
    confirmed_at TEXT,
    confirmed_by TEXT,
    reject_reason TEXT
  )`);
  {
    const cols = db.exec(`PRAGMA table_info(return_requests)`)[0]?.values.map(r => r[1]) ?? [];
    // วันที่คืนงานจริงที่สมาชิกเลือกเอง (default วันนี้ แก้ไขได้) — ใช้เป็นค่าเริ่มต้นตอนเจ้าหน้าที่ยืนยัน
    if (!cols.includes('returned_at')) db.exec(`ALTER TABLE return_requests ADD COLUMN returned_at TEXT`);
  }

  // คำขอเบิกงานที่สมาชิกส่งเองผ่านลิงก์พอร์ทัลส่วนตัว — เช่นเดียวกับ return_requests
  // ต้องรอเจ้าหน้าที่ตรวจสอบแล้วกดยืนยันก่อนถึงจะกลายเป็นใบเบิกจริงในตาราง issues
  db.exec(`CREATE TABLE IF NOT EXISTS issue_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT DEFAULT (datetime('now')),
    confirmed_issue_id INTEGER,
    confirmed_at TEXT,
    confirmed_by TEXT,
    reject_reason TEXT
  )`);
  {
    const cols = db.exec(`PRAGMA table_info(issue_requests)`)[0]?.values.map(r => r[1]) ?? [];
    // วันที่เบิกงานจริงที่สมาชิกเลือกเอง (default วันนี้ แก้ไขได้) — ใช้เป็นค่าเริ่มต้นตอนเจ้าหน้าที่ยืนยัน
    if (!cols.includes('issued_at')) db.exec(`ALTER TABLE issue_requests ADD COLUMN issued_at TEXT`);
  }

  // ค่าตอบแทนผู้บริหารรายเดือน (กำหนดเองต่อเดือน — ถ้าไม่กำหนดจะใช้ค่าอัตโนมัติ % ของรายได้)
  db.exec(`CREATE TABLE IF NOT EXISTS manager_month (
    month TEXT NOT NULL,
    manager_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (month, manager_id)
  )`);

  // สินทรัพย์/การลงทุนของกลุ่ม + การทยอยคืนเงินเจ้าของ
  db.exec(`CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    purchase_date TEXT,
    owner_advanced INTEGER DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS asset_repayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  const returnCols = db.exec(`PRAGMA table_info(returns)`)[0]?.values.map(r => r[1]) ?? [];
  if (!returnCols.includes('pay_cycle')) {
    db.exec(`ALTER TABLE returns ADD COLUMN pay_cycle TEXT`);
  }
  // แยกงานเสีย: ng_cut = เสียจากการตัด (หักเงิน), ng_factory = เสียจากโรงงาน (จ่ายปกติ)
  // defect_qty = ng_cut + ng_factory (คงไว้เป็นยอดรวมให้ระบบสต็อก/คุณภาพใช้ต่อ)
  if (!returnCols.includes('ng_cut')) {
    db.exec(`ALTER TABLE returns ADD COLUMN ng_cut REAL NOT NULL DEFAULT 0`);
    // ของเดิม: ถือว่างานเสียทั้งหมดเป็น "เสียจากการตัด" (รักษาการคิดเงินเดิม)
    db.exec(`UPDATE returns SET ng_cut = defect_qty WHERE ng_cut = 0`);
  }
  if (!returnCols.includes('ng_factory')) {
    db.exec(`ALTER TABLE returns ADD COLUMN ng_factory REAL NOT NULL DEFAULT 0`);
  }
  // งานหาย: บันทึกไว้เป็น record (จ่ายค่าแรงปกติ ไม่หักเงิน) — นับรวมในยอดคืนเพื่อปิดใบเบิกได้
  if (!returnCols.includes('lost_qty')) {
    db.exec(`ALTER TABLE returns ADD COLUMN lost_qty REAL NOT NULL DEFAULT 0`);
  }
  // ค่าใช้จ่ายบริหารจัดการ: ระบุผู้รับเงินได้ (general/member/manager) — ถ้าจ่ายให้สมาชิก/ผู้บริหาร นับรวมค่าตอบแทนผู้บริหาร
  const expCols = db.exec(`PRAGMA table_info(expenses)`)[0]?.values.map(r => r[1]) ?? [];
  if (!expCols.includes('paid_to_type')) db.exec(`ALTER TABLE expenses ADD COLUMN paid_to_type TEXT`);       // 'general' | 'member' | 'manager'
  if (!expCols.includes('paid_to_id'))   db.exec(`ALTER TABLE expenses ADD COLUMN paid_to_id INTEGER`);
  if (!expCols.includes('paid_to_name')) db.exec(`ALTER TABLE expenses ADD COLUMN paid_to_name TEXT`);
  save();

  // Backfill pay_cycle for existing returns (compute from returned_at)
  {
    const cfgRows = (db.exec(`SELECT key, value FROM settings`)[0]?.values ?? []).map(r => ({ key: r[0] as string, value: r[1] as string }));
    const { holidays, overrides, cutoffDay } = loadCutoffConfig(cfgRows);
    const rows = db.exec(`SELECT id, returned_at FROM returns WHERE pay_cycle IS NULL OR pay_cycle = ''`)[0];
    if (rows) {
      for (const v of rows.values) {
        const id = v[0]; const returnedAt = v[1] as string;
        if (!returnedAt) continue;
        const pc = computePayCycle(returnedAt, holidays, overrides, cutoffDay);
        db.run(`UPDATE returns SET pay_cycle = ? WHERE id = ?`, [pc, id]);
      }
      save();
    }
  }

  // ── ดัชนี (index) เพิ่มความเร็วคิวรี — คอลัมน์เหล่านี้ถูก join/filter บ่อยมากในหน้ารายงานต่างๆ (ยอดคืนงานต่อใบเบิก,
  // ยอดต่อสมาชิก/สินค้า, กรองตามวันที่/รอบจ่าย ฯลฯ) ไม่เคยมีดัชนีมาก่อนเลย ทำให้ query ที่มี subquery ซ้อนต้อง scan
  // ทั้งตารางทุกครั้ง ยิ่งข้อมูลสะสมเยอะยิ่งช้า (ยืนยันจริงจาก /api/issues ที่ใช้เวลา 7 วิบน production) — สร้างครั้งเดียว
  // แล้วอยู่ถาวร ไม่กระทบข้อมูลเดิม
  db.exec(`CREATE INDEX IF NOT EXISTS idx_returns_issue_id ON returns(issue_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_returns_pay_cycle ON returns(pay_cycle)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_returns_returned_at ON returns(returned_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_issues_member_id ON issues(member_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_issues_product_id ON issues(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_issues_issued_at ON issues(issued_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_receives_product_id ON receives(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_receives_received_at ON receives(received_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id ON shipment_items(shipment_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shipment_items_product_id ON shipment_items(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shipments_shipped_at ON shipments(shipped_at)`);
  save();

  // default settings
  const defaults = [
    ['max_pending_units', '500'],
    ['overdue_days_limit', '30'],
    ['defect_wage_percent', '0'],
    ['admin_name', 'แอดมิน'],
    ['group_deduction_percent', '0'],
    ['admin_cost_percent', '0'],
    ['withholding_tax_percent', '3'],
    ['ng_penalty_per_unit', '20'],  // ค่าปรับ (บาท) ต่อเส้น NG-ตัด ที่เกินเกณฑ์ % ยอมรับได้
  ];
  for (const [k, v] of defaults) {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
  }
  save();

  // สำรองข้อมูลทันทีตอนเปิด + ทุกวัน
  backupDaily();
  setInterval(backupDaily, 6 * 60 * 60 * 1000); // เช็คทุก 6 ชม. (สร้างไฟล์วันละ 1 ครั้ง)

  return { prepare, exec };
}

// รหัสอิงวันที่ของเอกสารจริง (ไม่ใช่วันที่บันทึก) เช่น IS260722-01, IS260722-02 (ใบที่ 2 ของวันนั้น)
// ใช้กับเอกสารที่มี "วันที่" สื่อความหมาย: รับของ/เบิกงาน/รับคืน/ส่งของ
export function nextDateCode(prefix: string, table: string, docDate: string, field: string = 'code'): string {
  const d = new Date(docDate);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const datePart = `${yy}${mm}${dd}`;
  const dayPrefix = `${prefix}${datePart}-`;
  const res = db.exec(`SELECT ${field} FROM ${table} WHERE ${field} LIKE '${dayPrefix}%'`);
  const codes = (res[0]?.values ?? []).map(r => String(r[0]));
  const re = new RegExp(`^${dayPrefix}(\\d+)$`);
  let maxNum = 0;
  for (const c of codes) { const mNum = re.exec(c); if (mNum) maxNum = Math.max(maxNum, Number(mNum[1])); }
  const used = new Set(codes);
  let num = maxNum + 1;
  let code = `${dayPrefix}${String(num).padStart(2, '0')}`;
  while (used.has(code)) { num++; code = `${dayPrefix}${String(num).padStart(2, '0')}`; }
  return code;
}

export function nextCode(prefix: string, table: string, field: string = 'code'): string {
  // ใช้เลขสูงสุดที่เคยใช้ +1 (กันรหัสซ้ำเมื่อมีการลบรายการไปก่อนหน้า) แล้ววนหาจนกว่าจะว่างจริง
  const res = db.exec(`SELECT ${field} FROM ${table} WHERE ${field} LIKE '${prefix}%'`);
  const codes = (res[0]?.values ?? []).map(r => String(r[0]));
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let maxNum = 0;
  for (const c of codes) { const mm = re.exec(c); if (mm) maxNum = Math.max(maxNum, Number(mm[1])); }
  const used = new Set(codes);
  let num = maxNum + 1;
  let code = `${prefix}${String(num).padStart(3, '0')}`;
  while (used.has(code)) { num++; code = `${prefix}${String(num).padStart(3, '0')}`; }
  return code;
}

export { prepare, exec };
export default { prepare, exec };
