import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';
import { deliveryCutoffRange, todayThai } from '../payCycle';
import { STOCK_CUTOFF } from '../stockConfig';
import { lotVariances, lotKey, computeLots } from '../receivedActual';

const router = Router();

router.get('/', (req, res) => {
  const { product_id, from, to, date } = req.query;
  let sql = `SELECT r.*, p.name as product_name, p.unit, p.color, p.project FROM receives r JOIN products p ON r.product_id = p.id WHERE 1=1`;
  const params: any[] = [];
  if (product_id) { sql += ` AND r.product_id = ?`; params.push(product_id); }
  if (date) {
    const d = String(date);
    if (/^\d{4}-\d{2}$/.test(d)) {
      // โหมด "รายเดือน" — รอบเดือนอิงวันรับของจริงจากโรงงาน (ไม่ใช่ปฏิทิน 1-สิ้นเดือน)
      // ให้ยอดรับเข้าตรงกับรอบที่ของจริงเข้ามา เทียบกับยอดเบิกออกแล้วไม่งง (คนละตัวกับรอบจ่ายค่าแรง)
      const lastRecvRows = prepare(`SELECT substr(received_at,1,7) as ym, MAX(received_at) as last FROM receives GROUP BY ym`).all() as any[];
      const lastRecvByMonth = Object.fromEntries(lastRecvRows.map((r: any) => [r.ym, r.last]));
      const { start, end } = deliveryCutoffRange(d, lastRecvByMonth);
      sql += ` AND r.received_at >= ? AND r.received_at <= ?`; params.push(start, end);
    } else {
      sql += ` AND r.received_at LIKE ?`; params.push(`${d}%`);
    }
  }
  if (from) { sql += ` AND r.received_at >= ?`; params.push(from); }
  if (to) { sql += ` AND r.received_at <= ?`; params.push(to); }
  sql += ` ORDER BY r.received_at DESC, r.id DESC`;
  res.json(withActual(prepare(sql).all(...params) as any[]));
});

/* แถวใบรับ + จำนวนรับจริง (เดิมอยู่ใน GET / — แยกออกมาให้ /balance ใช้สูตรเดียวกันเป๊ะ) */
function withActual(rows: any[]) {

  /* จำนวนรับจริง — ดูคำอธิบายเต็มที่ server/receivedActual.ts
     ล็อตหนึ่ง (สินค้า + วันที่รับ) อาจมีใบรับหลายใบ เช่นรอบเช้า/รอบบ่ายของวันเดียวกัน
     ส่วนต่างที่มาจาก "สมาชิกแจ้งทีหลัง" เป็นของทั้งล็อต ลงไว้ที่ใบล่าสุดใบเดียว เวลารวมคอลัมน์จะได้ไม่นับซ้ำ
     ส่วนยอดที่นับเองตอนรับของ (actual_qty) ผูกกับใบนั้นๆ ตรงๆ อยู่แล้ว */
  const variances = lotVariances();
  const autoOf = new Map(computeLots().filter(l => l.auto).map(l => [lotKey(l.product_id, l.lot_date), l.auto]));
  const lastIdOf = new Map<string, number>();
  const countedOf = new Map<string, number>();   // ผลรวมส่วนต่างที่มาจากการนับเองของทุกใบในล็อต
  for (const r of rows) {
    const k = lotKey(r.product_id, r.received_at);
    if (!lastIdOf.has(k) || r.id > lastIdOf.get(k)!) lastIdOf.set(k, r.id);
    if (r.actual_qty !== null && r.actual_qty !== undefined) {
      countedOf.set(k, (countedOf.get(k) || 0) + (Number(r.actual_qty) - (Number(r.quantity) || 0)));
    }
  }
  return rows.map(r => {
    const k = lotKey(r.product_id, r.received_at);
    const counted = r.actual_qty !== null && r.actual_qty !== undefined
      ? Number(r.actual_qty) - (Number(r.quantity) || 0) : 0;
    // ส่วนต่างของทั้งล็อต หักส่วนที่นับเองไว้แล้ว = ส่วนที่สมาชิกแจ้งทีหลัง (ลงที่ใบล่าสุดใบเดียว)
    const reported = lastIdOf.get(k) === r.id
      ? (variances.get(k) || 0) - (countedOf.get(k) || 0) : 0;
    const variance_qty = counted + reported;
    // counted_qty = ยอดที่นับเองตอนรับของ (null = ยังไม่ได้นับ)  ·  actual_qty = ยอดรับจริงที่ใช้คิดสต็อก
    const variance_auto = lastIdOf.get(k) === r.id ? (autoOf.get(k) || 0) : 0;
    return { ...r, counted_qty: r.actual_qty ?? null, variance_qty, variance_auto,
             actual_qty: (Number(r.quantity) || 0) + variance_qty };
  });
}

/* ช่วงวันที่จากตัวกรอง (date = วัน/เดือน, from/to) — กติกาเดียวกับ GET / และรายการใบเบิก
   เดือน = รอบส่งของจริงของโรงงาน (deliveryCutoffRange) ไม่ใช่ปฏิทิน 1–สิ้นเดือน */
function periodOf(q: any): { start: string | null; end: string | null } {
  let start: string | null = null, end: string | null = null;
  const d = q.date ? String(q.date) : '';
  if (/^\d{4}-\d{2}$/.test(d)) {
    const lastRecvRows = prepare(`SELECT substr(received_at,1,7) as ym, MAX(received_at) as last FROM receives GROUP BY ym`).all() as any[];
    const r = deliveryCutoffRange(d, Object.fromEntries(lastRecvRows.map((x: any) => [x.ym, x.last])));
    start = r.start; end = r.end;
  } else if (d) { start = d; end = d + '\uffff'; }
  if (q.from) start = String(q.from);
  if (q.to) end = String(q.to);
  return { start, end };
}

/* ยอดยกมา / รับเข้า / เบิกออก / คงเหลือ ต่อชนิดงาน ของช่วงที่เลือก — ตารางเทียบรับเข้า-เบิกออก (หน้าใบเบิก)
   ยกมา/คงเหลือ = "ของรอแจกจ่าย" ตามระบบล็อต (นับตั้งแต่ STOCK_CUTOFF เหมือนหน้าสต็อก) ณ ต้นช่วง / ท้ายช่วง
     = รับจริงของล็อตที่รับถึงวันนั้น − ยอดเบิกที่หักจากล็อตเหล่านั้น (ใบเบิกถึงวันนั้น) · รวมล็อตที่ติดลบด้วย (เบิกเกินโผล่ให้เห็น)
   รับเข้า/เบิกออก = ยอดเคลื่อนไหวในช่วง (ตัวเลขเดิมของตาราง)
   ปกติ ยกมา + รับเข้า − เบิกออก = คงเหลือ · ไม่ลงตัว (outside) = ส่วนที่เป็นของก่อนเริ่มนับสต็อก
   (รับก่อน STOCK_CUTOFF หรือใบเบิกที่หักของก่อน STOCK_CUTOFF) — ถ้าเป็นลบมาก = เบิกเกินของที่มีก่อนเริ่มนับ ต้องตรวจ */
router.get('/balance', (req, res) => {
  const { start, end } = periodOf(req.query);
  /* วันรอยต่อรอบ: รอบเดือนที่ปิดแล้วจบที่ "วันที่โรงงานส่งของครั้งสุดท้ายของเดือน" ซึ่งเป็นวันเริ่มของรอบถัดไปด้วย
     รับเข้า/เบิกออกของวันนั้น = ของรอบถัดไป (กติกาเดียวกับหน้าสต็อกสินค้า เข้า-ออก) → ตัดออกจากรอบที่ปิดแล้ว
     ไม่งั้นวันรอยต่อถูกนับ 2 เดือน: คงเหลือ ก.ย. ≠ ยกมา ต.ค. (เช่น ป้ายขาว รับ 30 ก.ย. เบิกไม่หมดวันนั้น) */
  const ym = typeof req.query.date === 'string' && /^\d{4}-\d{2}$/.test(req.query.date) ? req.query.date : '';
  const endExcl = !!ym && !req.query.to && ym !== todayThai().slice(0, 7) && !!end
    && !!(prepare(`SELECT 1 FROM receives WHERE substr(received_at, 1, 10) = ? LIMIT 1`).get(String(end).slice(0, 10)));
  const day = (x: string) => x.slice(0, 10);
  const before = (x: string, edge: string | null) => !edge || day(x) < day(edge);          // ก่อนต้นช่วง
  const upTo = (x: string, edge: string | null) => !edge || (endExcl ? day(x) < day(edge) : x <= edge);   // ถึงท้ายช่วง
  const inP = (x: string) => (!start || day(x) >= day(start)) && upTo(x, end);
  const out = new Map<number, any>();
  const row = (pid: number) => {
    if (!out.has(pid)) out.set(pid, { product_id: pid, received: 0, issued: 0, opening: 0, closing: 0, now: 0 });
    return out.get(pid);
  };
  for (const r of withActual(prepare(`SELECT * FROM receives`).all() as any[])) {
    const x = String(r.received_at || ''), q = Number(r.actual_qty) || 0, w = row(r.product_id);
    if (inP(x)) w.received += q;
    if (x.slice(0, 10) < STOCK_CUTOFF) continue;   // ของก่อนเริ่มนับสต็อก ไม่อยู่ในระบบล็อต
    if (start && before(x, start)) w.opening += q;
    if (upTo(x, end)) w.closing += q;
    if (!start) { /* ไม่มีต้นช่วง = ยกมา 0 */ }
  }
  // ยอดเบิกที่หักจากล็อตในระบบ: ใบที่ผูกล็อตแล้ว = ทั้งใบ · ใบเก่าที่ไม่ผูกล็อต = เท่าที่ระบบจัดสรรให้ล็อต (FIFO)
  const alloc = new Map<number, Map<string, number>>();
  const lots = computeLots(undefined, alloc);
  for (const i of prepare(`SELECT id, product_id, issued_at, quantity, lot_date FROM issues`).all() as any[]) {
    const x = String(i.issued_at || ''), q = Number(i.quantity) || 0, w = row(i.product_id);
    if (inP(x)) w.issued += q;
    const tracked = i.lot_date ? (String(i.lot_date) >= STOCK_CUTOFF ? q : 0)
      : [...(alloc.get(i.id)?.values() || [])].reduce((s, v) => s + v, 0);
    if (!tracked) continue;
    if (start && before(x, start)) w.opening -= tracked;
    if (upTo(x, end)) w.closing -= tracked;
  }
  // ปรับยอดรอแจกจ่าย: มีผล ณ วันที่ปรับ (ของออกจากหน้างานโดยไม่มีใบเบิก) — แยกเป็นช่อง adjusted ไม่ปนกับยอดเบิก
  for (const a of prepare(`SELECT product_id, adjusted_at, quantity, lot_date FROM waiting_adjustments`).all() as any[]) {
    if (String(a.lot_date) < STOCK_CUTOFF) continue;
    const x = String(a.adjusted_at || ''), q = Number(a.quantity) || 0, w = row(a.product_id);
    if (start && before(x, start)) w.opening += q;
    if (upTo(x, end)) w.closing += q;
    if (inP(x)) w.adjusted = (w.adjusted || 0) + q;
  }
  for (const l of lots) row(l.product_id).now += l.remaining;
  const names = new Map((prepare(`SELECT id, name, color, unit FROM products`).all() as any[]).map((p: any) => [p.id, p]));
  res.json({
    start, end, end_exclusive: endExcl, stock_cutoff: STOCK_CUTOFF,
    products: [...out.values()].filter(r => names.has(r.product_id)).map(r => {
      const p: any = names.get(r.product_id);
      return { product_id: r.product_id, name: p.name, color: p.color, unit: p.unit,
        opening: r.opening, received: r.received, issued: r.issued, adjusted: r.adjusted || 0, closing: r.closing, now: r.now,
        outside: r.closing - (r.opening + r.received - r.issued + (r.adjusted || 0)) };
    }),
  });
});

/* ยอดคงเหลือรายล็อต (สินค้า + วันที่รับ) ตั้งแต่ STOCK_CUTOFF เรียงเก่า -> ใหม่
   ใช้ทั้งตอนเลือกล็อตในใบเบิก และตอน "นับของหน้างาน" (ดู POST /count-waiting)
   ผลรวม remaining_qty ของทุกล็อต = ยอด "รอแจกจ่าย" ในหน้าสต็อกพอดี — กติกาเต็มอยู่ที่ computeLots */
function lotsOf(productId?: number) {
  // ใช้ computeLots (server/receivedActual.ts) เป็นแหล่งเดียว — ตัวเลขรายล็อตตรงกับหน้าสต็อก/ตารางเทียบรับเข้า-เบิกออก
  return computeLots(productId).map(l => ({
    product_id: l.product_id, lot_date: l.lot_date,
    received_qty: l.actual, received_note_qty: l.note,
    issued_qty: l.tagged + l.untagged, remaining_qty: l.remaining,
    auto_qty: l.auto,
  }));
}

/* ── ที่มาของส่วนต่าง "ยอดรับจริง − ใบส่งของ" ของล็อตหนึ่ง (คลิกช่อง ▲/▼ ในตารางรับของ) ──
   ส่วนประกอบ: นับเองที่ใบรับ (actual_qty) · ใบเบิกที่ส่วนต่าง quantity − orig_quantity ผูกล็อตนี้ (สมาชิกแจ้ง/แก้ยอดเบิก)
   · ระบบปรับอัตโนมัติ (ปิดล็อตที่คลาดไม่กี่เส้น — ไม่ใช่สิ่งที่ล้างได้ จะคิดใหม่เองหลังล้างส่วนอื่น) */
router.get('/lot-detail', (req, res) => {
  const pid = Number(req.query.product_id);
  const d = String(req.query.lot_date || '').slice(0, 10);
  if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  const lot = computeLots(pid).find(l => l.lot_date === d) || null;
  const receives = prepare(`SELECT id, code, quantity, actual_qty, actual_note, actual_by, actual_at FROM receives
    WHERE product_id = ? AND substr(received_at, 1, 10) = ? ORDER BY id`).all(pid, d);
  const issues = prepare(`SELECT i.id, i.code, substr(i.issued_at, 1, 10) issued_at, i.quantity, i.orig_quantity,
      i.quantity - i.orig_quantity diff, m.code member_code, m.name member_name, i.notes
    FROM issues i JOIN members m ON i.member_id = m.id
    WHERE i.product_id = ? AND i.lot_date = ? AND i.orig_quantity IS NOT NULL AND i.quantity != i.orig_quantity
    ORDER BY i.issued_at, i.id`).all(pid, d);
  const adjustments = prepare(`SELECT id, adjusted_at, quantity, reason, created_by FROM waiting_adjustments
    WHERE product_id = ? AND lot_date = ? ORDER BY id`).all(pid, d);
  res.json({ lot, receives, issues, adjustments });
});

/* ล้างส่วนต่างที่เลือก ให้ยอดรับจริงกลับไปตามใบส่งของ
   • issue_ids: ถือว่ายอดเบิกปัจจุบันถูกต้องแล้ว (แก้เพราะพิมพ์ผิด) → orig_quantity = quantity (ไม่แตะยอดเบิก/ค่าแรง)
   • clear_counted: ล้างยอดนับเองที่ใบรับของล็อตนี้ (กลับไปใช้ยอดตามใบส่งของ) */
router.post('/lot-reset', (req, res) => {
  const pid = Number(req.body?.product_id);
  const d = String(req.body?.lot_date || '').slice(0, 10);
  if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  const ids: number[] = Array.isArray(req.body?.issue_ids) ? req.body.issue_ids.map(Number).filter(Boolean) : [];
  const before = computeLots(pid).find(l => l.lot_date === d);
  let issuesCleared = 0, countsCleared = 0;
  for (const id of ids) {
    const r = prepare(`UPDATE issues SET orig_quantity = quantity WHERE id = ? AND product_id = ? AND lot_date = ?`).run(id, pid, d);
    issuesCleared += Number((r as any)?.changes ?? 1);
  }
  if (req.body?.clear_counted === true) {
    prepare(`UPDATE receives SET actual_qty = NULL, actual_note = NULL, actual_by = NULL, actual_at = NULL WHERE product_id = ? AND substr(received_at, 1, 10) = ?`).run(pid, d);
    countsCleared = 1;
  }
  const after = computeLots(pid).find(l => l.lot_date === d);
  res.json({ ok: true, issues_cleared: ids.length, counts_cleared: countsCleared, before: before?.actual, after: after?.actual, note: after?.note });
});

/* กำหนด "ยอดรับจริง" ของล็อตเอง (นับแล้ว / ใช้ยอดตามใบส่งของ) — ล็อตที่กำหนดเองระบบไม่ปรับอัตโนมัติทับ
   ยอดรับจริงของล็อต = ยอดนับเองที่ใบรับ + ส่วนต่างที่ผูกจากใบเบิก (สมาชิกแจ้ง) → ตั้งยอดนับเอง = เป้าหมาย − ส่วนต่างจากใบเบิก
   ล็อตที่มีหลายใบรับ: ใบอื่นใช้ยอดตามใบส่งของ ใบสุดท้ายรับส่วนต่างทั้งหมด */
router.post('/lot-set-actual', (req, res) => {
  const pid = Number(req.body?.product_id);
  const d = String(req.body?.lot_date || '').slice(0, 10);
  const target = Number(req.body?.actual);
  if (!pid || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(target) || target < 0) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  const recs = prepare(`SELECT id, quantity FROM receives WHERE product_id = ? AND substr(received_at, 1, 10) = ? ORDER BY id`).all(pid, d) as any[];
  if (recs.length === 0) return res.status(404).json({ error: 'ไม่พบใบรับของล็อตนี้' });
  const before = computeLots(pid).find(l => l.lot_date === d);
  const reported = before?.reported || 0;
  const countedTotal = target - reported;
  const note = recs.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const by = userOf(req);
  recs.forEach((r, k) => {
    const last = k === recs.length - 1;
    const v = last ? (Number(r.quantity) || 0) + (countedTotal - note) : (Number(r.quantity) || 0);
    prepare(`UPDATE receives SET actual_qty = ?, actual_note = ?, actual_by = ?, actual_at = datetime('now') WHERE id = ?`)
      .run(Math.max(0, v), 'กำหนดยอดรับจริงของล็อต', by, r.id);
  });
  const after = computeLots(pid).find(l => l.lot_date === d);
  res.json({ ok: true, before: before?.actual, after: after?.actual, note });
});

router.get('/lots', (req, res) => {
  const productId = req.query.product_id ? parseInt(req.query.product_id as string, 10) : 0;
  res.json(lotsOf(productId || undefined));
});

/* ── "นับของหน้างาน" ─────────────────────────────────────────────────────
   นับของที่ยังไม่ได้แจกของสินค้าหนึ่งแล้วกรอกยอดที่นับได้ทีเดียว ระบบไล่แก้ "ยอดรับจริง" ของล็อตให้เอง:
     • นับได้น้อยกว่าระบบ → ไล่ตัดล็อตเก่าสุดก่อน (ล็อตที่ปิดไม่ลง ค้างยอดผีอยู่) ทีละล็อตจนครบส่วนต่าง
       ตัดได้ไม่เกินยอดที่ล็อตนั้นเหลืออยู่ (ตัดจนติดลบไม่ได้) แล้วไล่ไปล็อตถัดไป
     • นับได้มากกว่าระบบ → ของเกินมากับล็อตใหม่สุด (โรงงานส่งเกินใบส่งของ) บวกเข้าที่ล็อตนั้น
   ผลคือยอดรอแจกจ่าย/พร้อมส่ง/บัตรคุมสต็อก/ตารางเทียบรับเข้า-เบิกออก ตรงกันหมดโดยอัตโนมัติ
   ไม่แตะยอดตามใบส่งของ และไม่กระทบค่าแรง/วางบิล
   ล็อตที่คนกรอกยอดรับจริงเองแล้ว (หน้ารับของ / ช่องนับที่ใบรับ) = ล็อก ไม่แตะเด็ดขาด — ปรับได้เฉพาะล็อตที่ยังไม่เคยกรอก
   หรือที่ปุ่มนี้เคยปรับไว้เอง ส่วนต่างที่ปรับไม่ได้แจ้งกลับ (unapplied) = ต้องไปตรวจใบเบิก ไม่ใช่ยอดรับ
   (เดิมไล่ตัดทุกล็อต — 9 ต.ค. 69 กดนับ 0 แล้วยอดรับจริงที่กรอกไว้ 11 ล็อตโดนทับ) */
const COUNT_NOTE = 'นับของหน้างาน';
const lockedLots = (productId: number) => new Set((prepare(`SELECT DISTINCT substr(received_at, 1, 10) d FROM receives
  WHERE product_id = ? AND actual_qty IS NOT NULL AND (actual_note IS NULL OR actual_note NOT LIKE '${COUNT_NOTE}%')`).all(productId) as any[]).map(r => r.d));
router.post('/count-waiting', (req, res) => {
  const productId = Number(req.body?.product_id);
  const counted = Number(req.body?.counted_qty);
  if (!productId || !isFinite(counted) || counted < 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่นับได้ (ไม่ติดลบ)' });
  }
  const lots = lotsOf(productId);
  if (lots.length === 0) return res.status(400).json({ error: 'สินค้านี้ยังไม่มีล็อตรับเข้าตั้งแต่วันเริ่มนับสต็อก' });
  const current = lots.reduce((s, l) => s + l.remaining_qty, 0);
  const note = `${COUNT_NOTE} ${todayThai()}${req.body?.note ? ` · ${String(req.body.note).trim()}` : ''}`;
  const locked = lockedLots(productId);
  const open = lots.filter(l => !locked.has(l.lot_date));
  let delta = counted - current;
  const changed: any[] = [];

  const applyToLot = (lot: any, amount: number) => {
    const lotDate = lot.lot_date;
    const rows = prepare(`SELECT * FROM receives WHERE product_id = ? AND substr(received_at,1,10) = ? ORDER BY id DESC`)
      .all(productId, lotDate) as any[];
    if (rows.length === 0) return;
    const target = rows[0];   // ล็อตหนึ่งอาจมีหลายใบ — ลงส่วนต่างไว้ที่ใบล่าสุดใบเดียว
    // ยอดที่นับเองจะแทนที่การปรับอัตโนมัติของล็อตนั้น — จึงต้องตั้งต้นจากยอดรวมที่ระบบปรับไว้แล้ว
    // ไม่งั้นส่วนที่ระบบปรับอัตโนมัติไว้จะหายไปแล้วยอดคลาดเท่านั้นพอดี
    const before = (Number(target.actual_qty ?? target.quantity) || 0) + (Number(lot.auto_qty) || 0);
    const after = before + amount;
    prepare(`UPDATE receives SET actual_qty = ?, actual_note = ?, actual_by = ?, actual_at = datetime('now') WHERE id = ?`)
      .run(after, note, userOf(req), target.id);
    changed.push({ receive_id: target.id, code: target.code, lot_date: lotDate, from: before, to: after, delta: amount });
  };

  if (delta < 0) {
    let left = -delta;
    for (const lot of open) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining_qty, left);
      if (take > 0) { applyToLot(lot, -take); left -= take; }
    }
    delta = -(-delta - left);   // ตัดได้จริงเท่าไหร่ (ล็อตที่ล็อกไว้ไม่แตะ จึงอาจไม่ครบ)
  } else if (delta > 0) {
    // ของเกินมากับล็อตล่าสุด — แก้ยอดรับได้เฉพาะเมื่อล็อตล่าสุดยังไม่ได้กรอกยอดเอง (ไม่ไปเติมล็อตเก่า)
    const newest = lots[lots.length - 1];
    if (!locked.has(newest.lot_date)) applyToLot(newest, delta); else delta = 0;
  }

  /* ส่วนที่ปรับยอดรับไม่ได้ (ล็อตที่กรอกยอดรับจริงไว้แล้ว = ล็อก) → ลงเป็น "ปรับยอดรอแจกจ่าย" รายล็อต
       ขาด (นับได้น้อยกว่าระบบ): ตัดล็อตที่ยังเหลือ เก่าสุดก่อน · เกิน: เติมล็อตที่ติดลบก่อน ที่เหลือลงล็อตล่าสุด */
  const adjusted: any[] = [];
  // วัดส่วนต่างที่เหลือจริงหลังแก้ล็อตที่เปิดอยู่ (การจัดสรรใบเบิกไม่ระบุล็อตอาจกินส่วนที่เติมไป)
  let left = counted - lotsOf(productId).reduce((s, l) => s + l.remaining_qty, 0);
  if (Math.abs(left) > 0.0001) {
    const today = todayThai();
    const reason = req.body?.note ? String(req.body.note).trim() : `นับของหน้างาน ${today}`;
    const add = (lot: string, q: number) => {
      prepare(`INSERT INTO waiting_adjustments (product_id, lot_date, adjusted_at, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(productId, lot, today, q, reason, userOf(req));
      adjusted.push({ lot_date: lot, qty: q });
    };
    const now = lotsOf(productId).filter(l => locked.has(l.lot_date));
    if (left < 0) {
      for (const l of now) { if (left >= -0.0001) break; const k = Math.min(Math.max(0, l.remaining_qty), -left); if (k > 0) { add(l.lot_date, -k); left += k; } }
    } else {
      for (const l of now) { if (left <= 0.0001) break; const k = Math.min(Math.max(0, -l.remaining_qty), left); if (k > 0) { add(l.lot_date, k); left -= k; } }
    }
    if (Math.abs(left) > 0.0001 && now.length) add(now[now.length - 1].lot_date, left);
  }
  const after = lotsOf(productId).reduce((s, l) => s + l.remaining_qty, 0);
  res.json({ before: current, counted, after, applied: delta, changed, adjusted, locked_lots: [...locked].sort() });
});

// ลบรายการปรับยอดรอแจกจ่าย (เช่น เจอใบเบิกที่ลงตกแล้ว แก้ที่ใบเบิกแทน)
router.delete('/waiting-adjustments/:id', (req, res) => {
  const r = prepare(`SELECT * FROM waiting_adjustments WHERE id = ?`).get(req.params.id) as any;
  if (!r) return res.status(404).json({ error: 'ไม่พบรายการปรับยอด' });
  prepare(`DELETE FROM waiting_adjustments WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

router.post('/', (req, res) => {
  const { received_at, product_id, quantity, factory_ref, notes } = req.body;
  if (!received_at || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  const code = nextDateCode('RC', 'receives', received_at);
  const result = prepare(`INSERT INTO receives (code, received_at, product_id, quantity, factory_ref, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(code, received_at, product_id, quantity, factory_ref || null, notes || null, userOf(req));
  res.json(prepare(`SELECT r.*, p.name as product_name, p.unit FROM receives r JOIN products p ON r.product_id = p.id WHERE r.id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { received_at, product_id, quantity, factory_ref, notes } = req.body;
  const rec = prepare(`SELECT * FROM receives WHERE id = ?`).get(req.params.id) as any;
  if (!rec) return res.status(404).json({ error: 'ไม่พบรายการรับของ' });
  if (!received_at || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  prepare(`UPDATE receives SET received_at=?, product_id=?, quantity=?, factory_ref=?, notes=? WHERE id=?`)
    .run(received_at, product_id, quantity, factory_ref || null, notes || null, req.params.id);
  res.json(prepare(`SELECT r.*, p.name as product_name, p.unit FROM receives r JOIN products p ON r.product_id = p.id WHERE r.id = ?`).get(req.params.id));
});

/* กรอก "ยอดที่นับได้จริง" ของใบรับใบนี้ — ใช้ตอนนับของลงจากรถแล้วไม่ตรงใบส่งของ
   ไม่แก้ยอดตามใบส่งของ (quantity) เก็บไว้เป็นหลักฐานคู่กับโรงงานเสมอ
   counted_qty = null → ล้างค่าที่นับเอง กลับไปใช้ยอดที่คำนวณจากที่สมาชิกแจ้งขาด/เกินแทน */
router.patch('/:id/counted', (req, res) => {
  const rec = prepare(`SELECT * FROM receives WHERE id = ?`).get(req.params.id) as any;
  if (!rec) return res.status(404).json({ error: 'ไม่พบรายการรับของ' });
  const raw = req.body?.counted_qty;
  const clear = raw === null || raw === undefined || raw === '';
  const qty = clear ? null : Number(raw);
  if (!clear && (!isFinite(qty as number) || (qty as number) < 0)) {
    return res.status(400).json({ error: 'จำนวนที่นับได้ต้องเป็นตัวเลขไม่ติดลบ' });
  }
  const issuedFromLot = (prepare(`SELECT COALESCE(SUM(quantity), 0) v FROM issues WHERE product_id = ? AND lot_date = ?`)
    .get(rec.product_id, String(rec.received_at).slice(0, 10)) as any).v || 0;
  // เตือนไว้เฉยๆ ไม่บล็อก — ยอดที่กรอกเองใช้ตามจริง ล็อตจะติดลบให้เห็น (ดู receivedActual.ts)
  const warn = !clear && (qty as number) < issuedFromLot
    ? `ยอดที่นับได้ (${qty}) น้อยกว่าที่แจกออกจากล็อตนี้ไปแล้ว (${issuedFromLot}) — ล็อตนี้จะติดลบ`
    : null;
  prepare(`UPDATE receives SET actual_qty = ?, actual_note = ?, actual_by = ?, actual_at = datetime('now') WHERE id = ?`)
    .run(qty, clear ? null : (req.body?.note ? String(req.body.note).trim() : null), clear ? null : userOf(req), req.params.id);
  const row = prepare(`SELECT r.*, p.name as product_name, p.unit FROM receives r JOIN products p ON r.product_id = p.id WHERE r.id = ?`).get(req.params.id);
  res.json({ ...(row as any), warn });
});

router.delete('/:id', (req, res) => {
  const rec = prepare(`SELECT * FROM receives WHERE id = ?`).get(req.params.id) as any;
  if (!rec) return res.status(404).json({ error: 'ไม่พบรายการรับของ' });
  prepare(`DELETE FROM receives WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true, code: rec.code });
});

export default router;
