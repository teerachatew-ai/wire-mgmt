import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { prepare, rawQuery } from './db';
import { userOf } from './reqUser';

/* ประวัติการแก้ไข (audit log)
 *
 * ใช้ trigger ของ SQLite: ทุกการเพิ่ม/แก้/ลบแถวในตารางหลักจะถูกเขียนลง _audit_buf (ค่าเดิม/ค่าใหม่เป็น JSON) อัตโนมัติ
 * ทุก request ที่เขียนข้อมูล (POST/PUT/PATCH/DELETE) ล้าง buffer ตอนเริ่ม แล้วตอนส่งคำตอบ (res.end — ยังอยู่ใน tick
 * เดียวกับ handler ที่เป็น sync จึงไม่ปนกับ request อื่น) อ่าน buffer มารวมเป็น 1 รายการประวัติ: ใคร ทำอะไร แถวไหน ค่าเดิม → ค่าใหม่
 * ข้อดี: route ไหนแก้อะไรก็ถูกจับหมด (รวม route ใหม่ในอนาคต) และกิน CPU เฉพาะแถวที่เปลี่ยนจริง ไม่ต้องถ่ายภาพทั้งตาราง
 * ไม่มีอะไรเปลี่ยน (เช่น POST ที่แค่คำนวณ/พรีวิว) = ไม่บันทึก */

const AUDITED = ['members', 'products', 'receives', 'issues', 'returns', 'shipments', 'shipment_items', 'stock_adjustments',
  'settings', 'managers', 'manager_month', 'expenses', 'recurring_expenses', 'assets', 'asset_repayments',
  'return_requests', 'issue_requests'];
const KEY: Record<string, string> = { settings: `X.key`, manager_month: `X.month || '|' || X.manager_id` };
const HIDE: Record<string, string[]> = { members: ['id_card_photo', 'portal_token'] };   // ใหญ่/ลับ — ไม่เก็บเลย
const MASK: Record<string, string[]> = { members: ['id_card'] };                         // บันทึกว่าเปลี่ยน แต่ไม่เก็บค่า

// สร้าง trigger ใหม่ทุกครั้งที่บูต (หลัง migration) — คอลัมน์ที่เพิ่มมาใหม่จะถูกรวมอัตโนมัติ
export function installAuditTriggers() {
  try { createTriggers(); }
  catch (e) {
    // ห้ามให้ระบบหลักพังเพราะประวัติ — ติดตั้งไม่สำเร็จ = ถอด trigger ทิ้งทั้งหมด (บันทึกงานได้ตามปกติ แค่ไม่มีประวัติ)
    console.error('[audit] install failed', e);
    for (const t of AUDITED) for (const op of ['pre', 'insert', 'update', 'delete']) { try { rawQuery(`DROP TRIGGER IF EXISTS _aud_${t}_${op}`); } catch {} }
  }
}
function createTriggers() {
  rawQuery(`CREATE TABLE IF NOT EXISTS _audit_buf (seq INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT, op TEXT, k TEXT, o TEXT, n TEXT)`);
  rawQuery(`DELETE FROM _audit_buf`);
  for (const t of AUDITED) {
    const cols = rawQuery(`PRAGMA table_info(${t})`).values.map(r => String(r[1])).filter(c => !(HIDE[t] || []).includes(c));
    if (cols.length === 0) continue;
    const obj = (X: string) => `json_object(${cols.map(c => `'${c}', ${X}."${c}"`).join(', ')})`;
    const key = (X: string) => (KEY[t] || `X.id`).replace(/X\./g, `${X}.`);
    for (const op of ['pre', 'insert', 'update', 'delete']) rawQuery(`DROP TRIGGER IF EXISTS _aud_${t}_${op}`);
    // INSERT OR REPLACE ทับแถวเดิม SQLite ไม่ยิง trigger ลบ — เก็บค่าเดิมไว้ก่อน (op 'pre') จะได้เทียบเป็น "แก้" ไม่ใช่ "เพิ่ม"
    rawQuery(`CREATE TRIGGER _aud_${t}_pre BEFORE INSERT ON ${t} WHEN EXISTS (SELECT 1 FROM ${t} X WHERE ${key('X')} = ${key('NEW')}) BEGIN
      INSERT INTO _audit_buf (t, op, k, o) VALUES ('${t}', 'pre', ${key('NEW')}, (SELECT ${obj('X')} FROM ${t} X WHERE ${key('X')} = ${key('NEW')})); END`);
    rawQuery(`CREATE TRIGGER _aud_${t}_insert AFTER INSERT ON ${t} BEGIN
      INSERT INTO _audit_buf (t, op, k, n) VALUES ('${t}', 'insert', ${key('NEW')}, ${obj('NEW')}); END`);
    rawQuery(`CREATE TRIGGER _aud_${t}_update AFTER UPDATE ON ${t} BEGIN
      INSERT INTO _audit_buf (t, op, k, o, n) VALUES ('${t}', 'update', ${key('NEW')}, ${obj('OLD')}, ${obj('NEW')}); END`);
    rawQuery(`CREATE TRIGGER _aud_${t}_delete AFTER DELETE ON ${t} BEGIN
      INSERT INTO _audit_buf (t, op, k, o) VALUES ('${t}', 'delete', ${key('OLD')}, ${obj('OLD')}); END`);
  }
}

// ไฟล์ดาวน์โหลด/พรีวิว/อ่านอย่างเดียว/งาน async — ไม่ต้องจับ
const SKIP = /-export|\/ng-preview|\/issue-lots|^\/(ocr|smartcard|line|export|audit)/;

const ACTIONS: [RegExp, string, string][] = [
  [/^POST \/issues$/, 'สร้างใบเบิก', 'เบิก'],
  [/^POST \/issues\/batch$/, 'สร้างใบเบิก (หลายรายการ)', 'เบิก'],
  [/^PATCH \/issues\/\d+\/quantity$/, 'แก้ยอดเบิก', 'เบิก'],
  [/^PUT \/issues\/\d+$/, 'แก้ใบเบิก', 'เบิก'],
  [/^POST \/issues\/transfer$/, 'โอนงานให้สมาชิกอื่น', 'เบิก'],
  [/^DELETE \/issues\/\d+$/, 'ลบใบเบิก', 'เบิก'],
  [/^POST \/returns$/, 'รับคืนงาน', 'รับคืน'],
  [/^POST \/returns\/batch$/, 'รับคืนงาน (เป็นชุด)', 'รับคืน'],
  [/^PUT \/returns\/\d+$/, 'แก้รายการรับคืน', 'รับคืน'],
  [/^DELETE \/returns\/\d+$/, 'ยกเลิกการคืน (Undo)', 'รับคืน'],
  [/^POST \/return-requests\/\d+\/confirm$/, 'ยืนยันคำขอคืนงานจากสมาชิก', 'รับคืน'],
  [/^POST \/return-requests\/\d+\/reject$/, 'ปฏิเสธคำขอคืนงาน', 'รับคืน'],
  [/^POST \/issue-requests\/\d+\/confirm$/, 'ยืนยันคำขอเบิกงานจากสมาชิก', 'เบิก'],
  [/^POST \/issue-requests\/\d+\/reject$/, 'ปฏิเสธคำขอเบิกงาน', 'เบิก'],
  [/^POST \/receives$/, 'รับของจากโรงงาน', 'รับของ/ล็อต'],
  [/^PUT \/receives\/\d+$/, 'แก้ใบรับของ', 'รับของ/ล็อต'],
  [/^PATCH \/receives\/\d+\/counted$/, 'แก้ยอดนับได้จริงของใบรับ', 'รับของ/ล็อต'],
  [/^DELETE \/receives\/\d+$/, 'ลบใบรับของ', 'รับของ/ล็อต'],
  [/^POST \/receives\/lot-reset$/, 'ย้อนยอดรับของล็อตเป็นตามใบส่งของ', 'รับของ/ล็อต'],
  [/^POST \/receives\/lot-set-actual$/, 'กำหนดยอดรับจริงของล็อต', 'รับของ/ล็อต'],
  [/^POST \/receives\/count-waiting$/, 'นับของหน้างาน', 'รับของ/ล็อต'],
  [/^POST \/stock-adjustments$/, 'ปรับยอดสต็อก', 'รับของ/ล็อต'],
  [/^DELETE \/stock-adjustments\/\d+$/, 'ลบรายการปรับยอดสต็อก', 'รับของ/ล็อต'],
  [/^POST \/shipments$/, 'ส่งงานออกโรงงาน', 'ส่งออก/วางบิล'],
  [/^PUT \/shipments\/\d+$/, 'แก้ใบส่งงาน', 'ส่งออก/วางบิล'],
  [/^DELETE \/shipments\/\d+$/, 'ลบใบส่งงาน', 'ส่งออก/วางบิล'],
  [/^PUT \/reports\/billing-sync$/, 'บันทึกใบวางบิล / NG โรงงาน', 'ส่งออก/วางบิล'],
  [/^PUT \/reports\/settings$/, 'แก้การตั้งค่า', 'ตั้งค่า'],
  [/^POST \/reports\/recompute-paycycles$/, 'คำนวณรอบค่าแรงใหม่', 'ตั้งค่า'],
  [/^PUT \/reports\/manager-month$/, 'แก้ค่าตอบแทนผู้บริหารรายเดือน', 'การเงิน'],
  [/^(POST|PUT|DELETE) \/expenses\/recurring/, 'ค่าใช้จ่ายประจำ', 'การเงิน'],
  [/^(POST|PUT|DELETE) \/expenses/, 'ค่าใช้จ่าย', 'การเงิน'],
  [/^(POST|PUT|DELETE) \/assets/, 'สินทรัพย์ / คืนเงินเจ้าของ', 'การเงิน'],
  [/^(POST|PUT|DELETE) \/managers/, 'ผู้บริหาร', 'ข้อมูลหลัก'],
  [/^POST \/members$/, 'เพิ่มสมาชิก', 'ข้อมูลหลัก'],
  [/^PUT \/members\/\d+$/, 'แก้ข้อมูลสมาชิก', 'ข้อมูลหลัก'],
  [/^DELETE \/members\/\d+$/, 'ลบสมาชิก', 'ข้อมูลหลัก'],
  [/^POST \/products$/, 'เพิ่มสินค้า', 'ข้อมูลหลัก'],
  [/^PUT \/products\/\d+$/, 'แก้ข้อมูลสินค้า', 'ข้อมูลหลัก'],
  [/^DELETE \/products\/\d+$/, 'ลบสินค้า', 'ข้อมูลหลัก'],
];
export const AUDIT_CATEGORIES = ['เบิก', 'รับคืน', 'รับของ/ล็อต', 'ส่งออก/วางบิล', 'การเงิน', 'ข้อมูลหลัก', 'ตั้งค่า', 'อื่นๆ'];

function actionOf(method: string, path: string): [string, string] {
  const k = `${method} ${path.replace(/\/+$/, '')}`;
  for (const [re, label, cat] of ACTIONS) if (re.test(k)) return [label, cat];
  return [k, 'อื่นๆ'];
}

// ── ป้ายชื่อแถว (อ่านง่าย + ยังอ่านออกแม้แถวถูกลบไปแล้ว) ──
function lookups() {
  const P = new Map<any, string>(), M = new Map<any, string>();
  for (const r of prepare(`SELECT id, name FROM products`).all() as any[]) P.set(r.id, r.name);
  for (const r of prepare(`SELECT id, code, name, nickname FROM members`).all() as any[]) M.set(r.id, `${r.code} ${r.nickname || r.name}`);
  return { P, M };
}
type Row = Record<string, any>;
const SETTING_LABEL: Record<string, string> = {
  pay_cutoff_day: 'วันตัดรอบค่าแรง', withholding_tax_percent: 'ภาษีหัก ณ ที่จ่าย (%)', defect_wage_percent: '% ค่าแรงงานเสีย',
  rework_deduct_percent: 'งานแก้ไข หักค่าแรง (%)', ng_group_rate_2: 'ค่าปรับ NG ตัดโดนสายไฟ ครั้งที่ 2', ng_group_rate_3: 'ค่าปรับ NG ตัดโดนสายไฟ ครั้งที่ 3+',
  ng_rope_rate: 'ค่าปรับ NG ดึงเชือก', ng_cut_allow: 'เกณฑ์ NG ตัดโดนสายไฟที่ยอมรับได้', ng_cut_allow_unit: 'หน่วยเกณฑ์ NG',
  ng_penalty_per_unit: 'ค่าปรับ NG ต่อเส้น (เดิม)', overdue_days_limit: 'ค้างคืนเกินกี่วัน', max_pending_units: 'ยอดค้างสูงสุดต่อคน',
  admin_cost_percent: '% ค่าบริหาร', admin_name: 'ชื่อผู้บริหาร', group_deduction_percent: '% หักเข้ากองกลาง', bill_ng_rate: 'โรงงานหักเงินงาน NG (%)',
  holidays: 'วันหยุด',
};

function labelOf(t: string, r: Row, L: ReturnType<typeof lookups>, issueOf: (id: any) => Row | undefined): string {
  const p = (id: any) => L.P.get(id) || `สินค้า #${id}`;
  const m = (id: any) => L.M.get(id) || `สมาชิก #${id}`;
  const d = (s: any) => String(s || '').slice(0, 10);
  switch (t) {
    case 'issues': return `${r.code} · ${m(r.member_id)} · ${p(r.product_id)} · เบิก ${d(r.issued_at)}`;
    case 'returns': {
      const i = issueOf(r.issue_id);
      return `${r.code} · คืน ${d(r.returned_at)}` + (i ? ` · ใบเบิก ${i.code} · ${m(i.member_id)} · ${p(i.product_id)}` : ` · ใบเบิก #${r.issue_id}`);
    }
    case 'receives': return `${r.code} · ${p(r.product_id)} · ล็อต ${d(r.received_at)}`;
    case 'shipments': return `${r.code} · ส่งวันที่ ${d(r.shipped_at)}`;
    case 'shipment_items': {
      const s = prepare(`SELECT code, shipped_at FROM shipments WHERE id = ?`).get(r.shipment_id) as any;
      return `${s ? `${s.code} (${d(s.shipped_at)})` : `ใบส่ง #${r.shipment_id}`} · ${p(r.product_id)}`;
    }
    case 'stock_adjustments': return `${p(r.product_id)} · ${d(r.adjusted_at)}`;
    case 'members': return `${r.code} ${r.name}${r.nickname ? ` (${r.nickname})` : ''}`;
    case 'products': return `${r.code} ${r.name}`;
    case 'settings': return SETTING_LABEL[r.key] || (String(r.key).startsWith('cutoff_') ? `วันตัดรอบค่าแรงเดือน ${String(r.key).slice(7)}` : r.key);
    case 'managers': return `ผู้บริหาร: ${r.name}`;
    case 'manager_month': return `ค่าตอบแทนผู้บริหาร ${r.month} · #${r.manager_id}`;
    case 'expenses': return `ค่าใช้จ่าย ${r.month} · ${r.description || ''}`;
    case 'recurring_expenses': return `ค่าใช้จ่ายประจำ: ${r.name}`;
    case 'assets': return `สินทรัพย์: ${r.name}`;
    case 'asset_repayments': return `คืนเงินสินทรัพย์ #${r.asset_id} · ${d(r.paid_at)}`;
    case 'return_requests': return `คำขอคืนงาน #${r.id} · ${m(r.member_id)}`;
    case 'issue_requests': return `คำขอเบิกงาน #${r.id} · ${m(r.member_id)}`;
    default: return `${t} #${r.id ?? ''}`;
  }
}
// ค่าในช่องที่เป็นรหัสอ้างอิง → ชื่อที่อ่านออก
function showVal(field: string, v: any, L: ReturnType<typeof lookups>, issueOf: (id: any) => Row | undefined): any {
  if (v == null || v === '') return v;
  if (field === 'member_id' || field === 'to_member_id') return L.M.get(v) || `#${v}`;
  if (field === 'product_id') return L.P.get(v) || `#${v}`;
  if (field === 'issue_id') return issueOf(v)?.code || `#${v}`;
  return v;
}

const MAX_CHANGES = 300;
// รวมเหตุการณ์จาก buffer เป็นรายการเปลี่ยนแปลงต่อแถว (แถวเดียวถูกแก้หลายครั้งใน request เดียว = ค่าแรกสุด → ค่าสุดท้าย)
function buildChanges(events: { t: string; op: string; k: string; o: string | null; n: string | null }[]) {
  const per = new Map<string, { t: string; k: string; first: string; o: Row | null; n: Row | null }>();
  for (const e of events) {
    const id = `${e.t}|${e.k}`;
    const o = e.o ? JSON.parse(e.o) : null, n = e.n ? JSON.parse(e.n) : null;
    const cur = per.get(id);
    if (!cur) per.set(id, { t: e.t, k: e.k, first: e.op, o, n });
    else cur.n = n;   // เก็บค่าเดิมของเหตุการณ์แรก + ค่าใหม่ของเหตุการณ์สุดท้าย (ลบ/pre = null)
  }
  const L = lookups();
  const issueCache = new Map<any, Row | undefined>();
  const issueOf = (id: any) => {
    if (!issueCache.has(id)) {
      const ev = per.get(`issues|${id}`);
      issueCache.set(id, ev ? (ev.n || ev.o) || undefined : (prepare(`SELECT * FROM issues WHERE id = ?`).get(id) as Row | undefined));
    }
    return issueCache.get(id);
  };
  const changes: any[] = [];
  let total = 0;
  for (const c of per.values()) {
    const mask = MASK[c.t] || [];
    const clean = (r: Row) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (v == null || v === '' || k === 'created_at') continue;
        o[k] = mask.includes(k) ? '***' : showVal(k, v, L, issueOf);
      }
      return o;
    };
    const was = c.first === 'insert' ? null : c.o;   // แถวที่เกิดใน request นี้ = ไม่มีค่าเดิม
    let item: any = null;
    if (!was && c.n) item = { t: c.t, op: 'insert', k: c.k, label: labelOf(c.t, c.n, L, issueOf), row: clean(c.n) };
    else if (was && !c.n) item = { t: c.t, op: 'delete', k: c.k, label: labelOf(c.t, was, L, issueOf), row: clean(was) };
    else if (was && c.n) {
      const f: Record<string, [any, any]> = {};
      for (const key of Object.keys(c.n)) {
        if (JSON.stringify(was[key]) !== JSON.stringify(c.n[key])) {
          f[key] = mask.includes(key) ? ['***', '***'] : [showVal(key, was[key], L, issueOf), showVal(key, c.n[key], L, issueOf)];
        }
      }
      if (Object.keys(f).length) item = { t: c.t, op: 'update', k: c.k, label: labelOf(c.t, c.n, L, issueOf), f };
    }
    if (item) { total++; if (changes.length < MAX_CHANGES) changes.push(item); }
  }
  return { changes, total };
}

// body ที่เก็บไว้ดูเหตุผลประกอบ — ตัดของใหญ่ทิ้ง
function bodyText(body: any): string | null {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null;
  const s = JSON.stringify(body, (k, v) => (/photo|image|base64|signature/i.test(k) ? '[ตัดออก]' : v));
  return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = req.path;
  if (SKIP.test(path)) return next();
  try { rawQuery(`DELETE FROM _audit_buf`); } catch { return next(); }

  // อ่าน buffer ตอน res.end — จังหวะเดียวกับที่ handler ส่งคำตอบ เหตุการณ์ใน buffer จึงเป็นของ request นี้เท่านั้น
  const origEnd = res.end.bind(res) as any;
  let done = false;
  (res as any).end = (...args: any[]) => {
    if (!done) {
      done = true;
      try {
        const { values } = rawQuery(`SELECT t, op, k, o, n FROM _audit_buf ORDER BY seq`);
        rawQuery(`DELETE FROM _audit_buf`);
        if (values.length) {
          const { changes, total } = buildChanges(values.map(v => ({ t: v[0], op: v[1], k: String(v[2]), o: v[3], n: v[4] })));
          if (total > 0) {
            const [action, category] = actionOf(req.method, path);
            const search = [action, ...changes.map(c => c.label)].join(' | ').slice(0, 4000);
            prepare(`INSERT INTO audit_log (user, method, path, action, category, status, body, changes, n_changes, search) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(userOf(req), req.method, path, action, category, res.statusCode, bodyText(req.body), JSON.stringify(changes), total, search);
          }
        }
      } catch (e) { console.error('[audit]', e); }
    }
    return origEnd(...args);
  };
  next();
}

// ── อ่านประวัติ ──
export const auditRouter = Router();
const TH = `datetime(at, '+7 hours')`;   // เก็บเป็น UTC แสดง/กรองเป็นเวลาไทย

auditRouter.get('/', (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : from;
  const where: string[] = [], params: any[] = [];
  if (from) { where.push(`substr(${TH}, 1, 10) >= ?`); params.push(from); }
  if (to) { where.push(`substr(${TH}, 1, 10) <= ?`); params.push(to); }
  if (req.query.user) { where.push(`user = ?`); params.push(String(req.query.user)); }
  if (req.query.category) { where.push(`category = ?`); params.push(String(req.query.category)); }
  if (req.query.q) { where.push(`search LIKE ?`); params.push(`%${String(req.query.q).trim()}%`); }
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  const rows = prepare(`SELECT id, ${TH} AS at_th, user, method, path, action, category, status, body, changes, n_changes
    FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`).all(...params) as any[];
  res.json(rows.map(r => {
    let body: any = null, changes: any[] = [];
    try { body = r.body ? JSON.parse(r.body) : null; } catch { body = r.body; }
    try { changes = JSON.parse(r.changes || '[]'); } catch {}
    return { ...r, body, changes };
  }));
});

auditRouter.get('/meta', (_req, res) => {
  const users = (prepare(`SELECT DISTINCT user FROM audit_log WHERE user IS NOT NULL ORDER BY user`).all() as any[]).map(r => r.user);
  const first = prepare(`SELECT MIN(${TH}) AS first FROM audit_log`).get() as any;
  res.json({ users, categories: AUDIT_CATEGORIES, since: first?.first || null });
});
