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

const AUDITED = ['members', 'products', 'receives', 'issues', 'returns', 'shipments', 'shipment_items', 'stock_adjustments', 'waiting_adjustments',
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
const SKIP = /-export|\/ng-preview|\/issue-lots|^\/(ocr|smartcard|line|export)\b|^\/audit(?!\/\d+\/revert)/;   // การย้อน (revert) ต้องถูกบันทึกด้วย

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
  [/^DELETE \/receives\/waiting-adjustments\/\d+$/, 'ลบรายการปรับยอดรอแจกจ่าย', 'รับของ/ล็อต'],
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
  rework_deduct_percent: 'งานแก้ไข หักค่าแรง (%)', ng_group_rate_2: 'ค่าปรับ NG โดยสมาชิก ครั้งที่ 2', ng_group_rate_3: 'ค่าปรับ NG โดยสมาชิก ครั้งที่ 3+',
  ng_rope_rate: 'ค่าปรับ NG ดึงเชือก', ng_cut_allow: 'เกณฑ์ NG โดยสมาชิกที่ยอมรับได้', ng_cut_allow_unit: 'หน่วยเกณฑ์ NG',
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
    case 'waiting_adjustments': return `ปรับยอดรอแจกจ่าย · ${p(r.product_id)} · ล็อต ${d(r.lot_date)}`;
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
interface Ctx { L: ReturnType<typeof lookups>; issueOf: (id: any) => Row | undefined; }
function makeCtx(rowsOf?: (t: string, k: string) => Row | null | undefined): Ctx {
  const L = lookups();
  const cache = new Map<any, Row | undefined>();
  const issueOf = (id: any) => {
    if (!cache.has(id)) cache.set(id, rowsOf?.('issues', String(id)) || (prepare(`SELECT * FROM issues WHERE id = ?`).get(id) as Row | undefined));
    return cache.get(id);
  };
  return { L, issueOf };
}

/* 1 รายการเปลี่ยนแปลง = ข้อมูลสำหรับแสดง (label/f/row เป็นชื่อที่อ่านออก) + ค่าดิบสำหรับย้อนกลับ
   ro = ค่าเดิม (แก้: เฉพาะช่องที่เปลี่ยน / ลบ: ทั้งแถว) · rn = ค่าใหม่ (เพิ่ม: ทั้งแถว / แก้: เฉพาะช่องที่เปลี่ยน) */
function makeChange(t: string, k: string, was: Row | null, now: Row | null, ctx: Ctx): any | null {
  const { L, issueOf } = ctx;
  const mask = MASK[t] || [];
  const clean = (r: Row) => {
    const o: Row = {};
    for (const [key, v] of Object.entries(r)) {
      if (v == null || v === '' || key === 'created_at') continue;
      o[key] = mask.includes(key) ? '***' : showVal(key, v, L, issueOf);
    }
    return o;
  };
  if (!was && now) return { t, op: 'insert', k, label: labelOf(t, now, L, issueOf), row: clean(now), rn: now };
  if (was && !now) return { t, op: 'delete', k, label: labelOf(t, was, L, issueOf), row: clean(was), ro: was };
  if (was && now) {
    const f: Record<string, [any, any]> = {}, ro: Row = {}, rn: Row = {};
    for (const key of Object.keys(now)) {
      if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) {
        f[key] = mask.includes(key) ? ['***', '***'] : [showVal(key, was[key], L, issueOf), showVal(key, now[key], L, issueOf)];
        ro[key] = was[key]; rn[key] = now[key];
      }
    }
    if (Object.keys(f).length) return { t, op: 'update', k, label: labelOf(t, now, L, issueOf), f, ro, rn };
  }
  return null;
}

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
  const ctx = makeCtx((t, k) => { const ev = per.get(`${t}|${k}`); return ev ? (ev.n || ev.o) : undefined; });
  const changes: any[] = [];
  let total = 0;
  for (const c of per.values()) {
    const item = makeChange(c.t, c.k, c.first === 'insert' ? null : c.o, c.n, ctx);   // แถวที่เกิดใน request นี้ = ไม่มีค่าเดิม
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

function insertLog(e: { at?: string; user: string | null; method: string; path: string; action: string; category: string; status: number;
  body: string | null; changes: any[]; total: number; source?: string; approx_note?: string | null; revert_of?: number | null }) {
  const search = [e.action, e.user || '', ...e.changes.map(c => c.label)].join(' | ').slice(0, 4000);
  prepare(`INSERT INTO audit_log (at, user, method, path, action, category, status, body, changes, n_changes, search, source, approx_note, revert_of)
    VALUES (COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.at || null, e.user, e.method, e.path, e.action, e.category, e.status, e.body, JSON.stringify(e.changes), e.total, search,
      e.source || 'live', e.approx_note || null, e.revert_of || null);
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
            insertLog({ user: userOf(req), method: req.method, path, status: res.statusCode, body: bodyText(req.body), changes, total,
              action: res.locals.auditAction || action, category: res.locals.auditCategory || category, revert_of: res.locals.revertOf });
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
const TH = (col: string) => `datetime(${col}, '+7 hours')`;   // เก็บเป็น UTC แสดง/กรองเป็นเวลาไทย

function revertableOf(r: any, changes: any[]): boolean {
  if (r.reverted_at || r.approx_note || r.revert_of) return false;
  if (!changes.length || changes.length < Number(r.n_changes)) return false;
  return changes.every(c => (c.op === 'insert' ? c.rn : c.op === 'delete' ? c.ro : c.ro && c.rn));
}

auditRouter.get('/', (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : from;
  const where: string[] = [], params: any[] = [];
  if (from) { where.push(`substr(${TH('at')}, 1, 10) >= ?`); params.push(from); }
  if (to) { where.push(`substr(${TH('at')}, 1, 10) <= ?`); params.push(to); }
  if (req.query.user) { where.push(`user = ?`); params.push(String(req.query.user)); }
  if (req.query.category) { where.push(`category = ?`); params.push(String(req.query.category)); }
  if (req.query.q) { where.push(`search LIKE ?`); params.push(`%${String(req.query.q).trim()}%`); }
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  const rows = prepare(`SELECT id, ${TH('at')} AS at_th, user, method, path, action, category, status, body, changes, n_changes,
      source, approx_note, ${TH('reverted_at')} AS reverted_at, reverted_by, revert_of
    FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT ${limit}`).all(...params) as any[];
  res.json(rows.map(r => {
    let body: any = null, changes: any[] = [];
    try { body = r.body ? JSON.parse(r.body) : null; } catch { body = r.body; }
    try { changes = JSON.parse(r.changes || '[]'); } catch {}
    const revertable = revertableOf(r, changes);
    return { ...r, body, revertable, changes: changes.map(({ ro, rn, ...c }) => c) };   // ค่าดิบไม่ต้องส่งไปหน้าเว็บ
  }));
});

auditRouter.get('/meta', (_req, res) => {
  const users = (prepare(`SELECT DISTINCT user FROM audit_log WHERE user IS NOT NULL ORDER BY user`).all() as any[]).map(r => r.user);
  const first = prepare(`SELECT MIN(${TH('at')}) AS first FROM audit_log WHERE source = 'live'`).get() as any;
  const back = prepare(`SELECT MIN(${TH('at')}) AS first FROM audit_log WHERE source = 'backfill'`).get() as any;
  // จำนวน trigger ที่ติดตั้งอยู่ (ควร = ตาราง x 4) — 0 = ระบบไม่ได้จับประวัติ ต้องตรวจ log ตอนบูต
  const triggers = Number(rawQuery(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_aud_%'`).values[0]?.[0] || 0);
  res.json({ users, categories: AUDIT_CATEGORIES, since: first?.first || null, backfill_since: back?.first || null, triggers });
});

// ── ย้อนการกระทำ ──
function keyWhere(t: string, k: string): [string, any[]] {
  if (t === 'settings') return [`key = ?`, [k]];
  if (t === 'manager_month') { const [m, id] = k.split('|'); return [`month = ? AND manager_id = ?`, [m, Number(id)]]; }
  return [`id = ?`, [Number(k)]];
}
// แถวลูกที่อ้างถึงแถวนี้ — ย้อน "เพิ่ม" (= ลบทิ้ง) ไม่ได้ถ้ายังมีลูกอยู่ (เช่นใบเบิกที่มีการคืนแล้ว)
const CHILDREN: Record<string, [string, string, string][]> = {
  issues: [['returns', 'issue_id', 'รายการรับคืน']],
  shipments: [['shipment_items', 'shipment_id', 'รายการส่งงาน']],
  members: [['issues', 'member_id', 'ใบเบิก']],
  products: [['issues', 'product_id', 'ใบเบิก'], ['receives', 'product_id', 'ใบรับของ']],
  assets: [['asset_repayments', 'asset_id', 'รายการคืนเงิน']],
};
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  || (a != null && b != null && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b));

auditRouter.post('/:id/revert', (req, res) => {
  const r = prepare(`SELECT * FROM audit_log WHERE id = ?`).get(Number(req.params.id)) as any;
  if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });
  let changes: any[] = [];
  try { changes = JSON.parse(r.changes || '[]'); } catch {}
  if (r.reverted_at) return res.status(409).json({ error: `รายการนี้ถูกย้อนไปแล้วโดย ${r.reverted_by || '-'}` });
  if (!revertableOf(r, changes)) return res.status(400).json({ error: 'รายการนี้ย้อนอัตโนมัติไม่ได้ (ข้อมูลย้อนหลังที่ไม่รู้ค่าเดิม หรือเป็นรายการย้อน/รายการใหญ่เกินไป)' });

  // ตรวจก่อนทำทุกแถว — มีแถวไหนถูกแก้ต่อหลังจากนี้ = ไม่ย้อนเลยสักแถว (กันข้อมูลเพี้ยนครึ่งๆ กลางๆ)
  const conflicts: string[] = [];
  const deleting = new Set(changes.filter(c => c.op === 'insert').map(c => `${c.t}|${c.k}`));
  for (const c of changes) {
    const [w, p] = keyWhere(c.t, c.k);
    const cur = prepare(`SELECT * FROM ${c.t} WHERE ${w}`).get(...p) as Row | undefined;
    if (c.op === 'insert') {
      if (!cur) continue;   // ถูกลบไปแล้ว — ไม่ต้องทำอะไร
      const diffF = Object.keys(c.rn).filter(f => f !== 'created_at' && f in cur && !same(cur[f], c.rn[f]));
      if (diffF.length) conflicts.push(`${c.label}: ถูกแก้ต่อหลังจากนี้ (${diffF.join(', ')})`);
      for (const [ct, col, name] of CHILDREN[c.t] || []) {
        const kids = (prepare(`SELECT id FROM ${ct} WHERE ${col} = ?`).all(Number(c.k)) as any[]).filter(x => !deleting.has(`${ct}|${x.id}`));
        if (kids.length) conflicts.push(`${c.label}: ยังมี${name}อ้างถึงอยู่ ${kids.length} รายการ`);
      }
    } else if (c.op === 'update') {
      if (!cur) { conflicts.push(`${c.label}: ถูกลบไปแล้ว`); continue; }
      const diffF = Object.keys(c.rn).filter(f => !same(cur[f], c.rn[f]));
      if (diffF.length) conflicts.push(`${c.label}: ถูกแก้ต่อหลังจากนี้ (${diffF.join(', ')})`);
    } else if (c.op === 'delete') {
      if (cur) { conflicts.push(`${c.label}: มีแถวนี้อยู่แล้ว`); continue; }
      if (c.ro.code) {
        const dup = prepare(`SELECT id FROM ${c.t} WHERE code = ?`).get(c.ro.code) as any;
        if (dup) conflicts.push(`${c.label}: เลขที่ ${c.ro.code} ถูกใช้กับรายการใหม่ไปแล้ว`);
      }
    }
  }
  if (conflicts.length) return res.status(409).json({ error: 'ย้อนไม่ได้ เพราะข้อมูลถูกแก้ต่อหลังจากรายการนี้', conflicts });

  for (const c of [...changes].reverse()) {
    const [w, p] = keyWhere(c.t, c.k);
    if (c.op === 'insert') prepare(`DELETE FROM ${c.t} WHERE ${w}`).run(...p);
    else if (c.op === 'update') {
      const cols = Object.keys(c.ro);
      prepare(`UPDATE ${c.t} SET ${cols.map(x => `"${x}" = ?`).join(', ')} WHERE ${w}`).run(...cols.map(x => c.ro[x]), ...p);
    } else if (c.op === 'delete') {
      const cols = Object.keys(c.ro);
      prepare(`INSERT INTO ${c.t} (${cols.map(x => `"${x}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(x => c.ro[x]));
    }
  }
  prepare(`UPDATE audit_log SET reverted_at = datetime('now'), reverted_by = ? WHERE id = ?`).run(userOf(req), r.id);
  res.locals.auditAction = `ย้อน: ${r.action}`;
  res.locals.auditCategory = r.category;
  res.locals.revertOf = r.id;
  res.json({ ok: true, reverted: changes.length });
});

/* ── สร้างประวัติย้อนหลังจากข้อมูลที่มีอยู่ (ก่อนเปิดใช้เมนูนี้) ──
   ระบบเดิมไม่ได้เก็บประวัติ จึงสร้างได้เฉพาะสิ่งที่ "มีเวลาบันทึกติดอยู่ในข้อมูล":
     • รายการที่สร้าง (ใบเบิก/รับคืน/รับของ/ส่งงาน/ปรับยอด...) จาก created_at — จัดกลุ่มตามคน+วินาทีเดียวกัน = 1 การกดบันทึก
     • ยอดรับจริงที่กำหนด/นับเองของใบรับ จาก actual_at (รู้แค่ค่าล่าสุด ไม่รู้ค่าเดิม)
     • ใบเบิกที่ยอดเบิก ≠ ยอดฐานล็อต = เคยแก้ยอดแบบ "นับในมัดไม่ตรง" (ไม่รู้เวลาแน่นอน)
     • extra: รายการแก้ที่รู้จากการเทียบข้อมูลสำรอง (ส่งมาจากภายนอก)
   รันซ้ำได้ (ลบของย้อนหลังเดิมทิ้งก่อน) · การแก้/ลบที่ไม่มีร่องรอยในข้อมูล กู้ไม่ได้ */
const BACKFILL_TABLES: [string, string, string][] = [
  ['issues', 'สร้างใบเบิก', 'เบิก'], ['returns', 'รับคืนงาน', 'รับคืน'], ['receives', 'รับของจากโรงงาน', 'รับของ/ล็อต'],
  ['shipments', 'ส่งงานออกโรงงาน', 'ส่งออก/วางบิล'], ['stock_adjustments', 'ปรับยอดสต็อก', 'รับของ/ล็อต'],
  ['expenses', 'ค่าใช้จ่าย', 'การเงิน'], ['recurring_expenses', 'ค่าใช้จ่ายประจำ', 'การเงิน'], ['assets', 'สินทรัพย์ / คืนเงินเจ้าของ', 'การเงิน'],
  ['asset_repayments', 'สินทรัพย์ / คืนเงินเจ้าของ', 'การเงิน'], ['return_requests', 'คำขอคืนงานจากสมาชิก', 'รับคืน'], ['issue_requests', 'คำขอเบิกงานจากสมาชิก', 'เบิก'],
];
function rowsSince(t: string, col: string, fromUtc: string): Row[] {
  const cols = rawQuery(`PRAGMA table_info(${t})`).values.map(r => String(r[1]));
  if (!cols.includes(col)) return [];
  const hide = HIDE[t] || [];
  const sel = cols.filter(c => !hide.includes(c)).map(c => `"${c}"`).join(', ');
  return prepare(`SELECT ${sel} FROM ${t} WHERE ${col} >= ? ORDER BY ${col}, id`).all(fromUtc) as Row[];
}

auditRouter.post('/backfill', (req, res) => {
  const from = String(req.body?.from || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: 'from = YYYY-MM-DD' });
  const fromUtc = (prepare(`SELECT datetime(?, '-7 hours') AS d`).get(from) as any).d;
  const liveFirst = (prepare(`SELECT MIN(at) AS a FROM audit_log WHERE source = 'live'`).get() as any)?.a || '9999';
  prepare(`DELETE FROM audit_log WHERE source = 'backfill'`).run();
  const ctx = makeCtx();
  const entries: any[] = [];
  const extraIssueIds = new Set<number>((req.body?.extra || []).flatMap((e: any) => (e.changes || []).filter((c: any) => c.t === 'issues').map((c: any) => Number(c.k))));

  // 1) รายการที่สร้าง — กลุ่มตาม (คน, เวลา) · รายการส่งงานผูกกับใบส่ง
  const groups = new Map<string, { at: string; user: string | null; items: [string, Row][] }>();
  for (const [t] of BACKFILL_TABLES) {
    for (const r of rowsSince(t, 'created_at', fromUtc)) {
      if (r.created_at >= liveFirst) continue;   // หลังเปิดใช้ประวัติจริง = มีบันทึกจริงอยู่แล้ว
      const g = `${r.created_by || ''}|${r.created_at}`;
      if (!groups.has(g)) groups.set(g, { at: r.created_at, user: r.created_by || null, items: [] });
      groups.get(g)!.items.push([t, r]);
      if (t === 'shipments') {
        for (const it of prepare(`SELECT * FROM shipment_items WHERE shipment_id = ?`).all(r.id) as Row[]) groups.get(g)!.items.push(['shipment_items', it]);
      }
    }
  }
  for (const g of groups.values()) {
    const main = BACKFILL_TABLES.find(([t]) => g.items.some(([x]) => x === t))!;
    const n = g.items.filter(([x]) => x === main[0]).length;
    const action = n > 1 && (main[0] === 'issues' || main[0] === 'returns') ? `${main[1]} (${main[0] === 'returns' ? 'เป็นชุด' : 'หลายรายการ'})` : main[1];
    const changes = g.items.map(([t, r]) => makeChange(t, String(r.id), null, r, ctx)).filter(Boolean);
    entries.push({ at: g.at, user: g.user, action, category: main[2], changes });
  }

  // 2) ยอดรับจริงที่กำหนด/นับเอง (รู้แค่ค่าล่าสุด)
  const acts = new Map<string, { at: string; user: string | null; note: string; items: Row[] }>();
  for (const r of rowsSince('receives', 'actual_at', fromUtc)) {
    if (r.actual_at >= liveFirst || r.actual_qty == null) continue;
    const g = `${r.actual_by || ''}|${String(r.actual_at).slice(0, 16)}|${r.actual_note || ''}`;
    if (!acts.has(g)) acts.set(g, { at: r.actual_at, user: r.actual_by || null, note: r.actual_note || '', items: [] });
    acts.get(g)!.items.push(r);
  }
  for (const g of acts.values()) {
    entries.push({
      at: g.at, user: g.user, category: 'รับของ/ล็อต',
      action: g.note === 'กำหนดยอดรับจริงของล็อต' ? 'กำหนดยอดรับจริงของล็อต' : `แก้ยอดนับได้จริงของใบรับ${g.note ? ` (${g.note})` : ''}`,
      approx_note: 'ระบบเดิมเก็บไว้แค่ค่าล่าสุด — ไม่ทราบค่าก่อนหน้า (ยอดตามใบส่งของแสดงไว้เทียบ)',
      changes: g.items.map(r => ({ t: 'receives', op: 'update', k: String(r.id), label: labelOf('receives', r, ctx.L, ctx.issueOf),
        f: { actual_qty: ['?', r.actual_qty] }, row: { quantity: r.quantity } })),
    });
  }

  // 3) ใบเบิกที่เคยแก้ยอดแบบ "นับในมัดไม่ตรง" (ยอดเบิก ≠ ยอดฐานล็อต) — ไม่รู้เวลาแน่นอน วางไว้ที่เวลาสร้างใบ
  for (const r of rowsSince('issues', 'created_at', fromUtc)) {
    if (r.orig_quantity == null || Number(r.orig_quantity) === Number(r.quantity) || extraIssueIds.has(Number(r.id))) continue;
    entries.push({
      at: r.created_at, user: r.created_by || null, category: 'เบิก', action: 'แก้ยอดเบิก (นับในมัดไม่ตรง)',
      approx_note: 'ไม่ทราบเวลาที่แก้แน่นอน (แก้หลังสร้างใบเบิก ก่อนเปิดใช้ประวัติ) · ยอดรับจริงของล็อตเปลี่ยนตาม',
      changes: [{ t: 'issues', op: 'update', k: String(r.id), label: labelOf('issues', r, ctx.L, ctx.issueOf), f: { quantity: [r.orig_quantity, r.quantity] } }],
    });
  }

  // 4) รายการที่รู้จากการเทียบข้อมูลสำรอง
  for (const e of req.body?.extra || []) {
    const changes = (e.changes || []).map((c: any) => {
      const r = prepare(`SELECT * FROM ${c.t === 'issues' ? 'issues' : 'receives'} WHERE id = ?`).get(Number(c.k)) as Row;
      return r ? { t: c.t, op: 'update', k: String(c.k), label: labelOf(c.t, r, ctx.L, ctx.issueOf), f: c.f } : null;
    }).filter(Boolean);
    if (changes.length) entries.push({ at: e.at, user: e.user || null, action: e.action, category: e.category || 'เบิก', approx_note: e.approx_note, changes });
  }

  for (const e of entries) {
    insertLog({ at: e.at, user: e.user, method: '-', path: 'backfill', action: e.action, category: e.category, status: 200, body: null,
      changes: e.changes.slice(0, MAX_CHANGES), total: e.changes.length, source: 'backfill', approx_note: e.approx_note });
  }
  res.json({ ok: true, entries: entries.length, from });
});
