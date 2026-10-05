import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';
import { deliveryCutoffRange } from '../payCycle';
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
  const rows = prepare(sql).all(...params) as any[];

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
  res.json(rows.map(r => {
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
  }));
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
  res.json({ lot, receives, issues });
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
   ไม่แตะยอดตามใบส่งของ และไม่กระทบค่าแรง/วางบิล */
router.post('/count-waiting', (req, res) => {
  const productId = Number(req.body?.product_id);
  const counted = Number(req.body?.counted_qty);
  if (!productId || !isFinite(counted) || counted < 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่นับได้ (ไม่ติดลบ)' });
  }
  const lots = lotsOf(productId);
  if (lots.length === 0) return res.status(400).json({ error: 'สินค้านี้ยังไม่มีล็อตรับเข้าตั้งแต่วันเริ่มนับสต็อก' });
  const current = lots.reduce((s, l) => s + l.remaining_qty, 0);
  const note = req.body?.note ? String(req.body.note).trim() : `นับของหน้างาน ${new Date().toISOString().slice(0, 10)}`;
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
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining_qty, left);
      if (take > 0) { applyToLot(lot, -take); left -= take; }
    }
    delta = -(-delta - left);   // ตัดได้จริงเท่าไหร่ (ปกติได้ครบ เพราะผลรวมล็อต = ยอดรอแจกจ่าย)
  } else if (delta > 0) {
    applyToLot(lots[lots.length - 1], delta);
  }

  const after = lotsOf(productId).reduce((s, l) => s + l.remaining_qty, 0);
  res.json({ before: current, counted, after, applied: delta, changed });
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
  // เตือนไว้เฉยๆ ไม่บล็อก — ยอดรับจริงมีพื้นล่างเป็นยอดที่แจกออกไปแล้วอยู่แล้ว (ดู receivedActual.ts)
  const warn = !clear && (qty as number) < issuedFromLot
    ? `ยอดที่นับได้ (${qty}) น้อยกว่าที่แจกออกจากล็อตนี้ไปแล้ว (${issuedFromLot}) — ระบบจะใช้ยอดที่แจกออกเป็นขั้นต่ำ`
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
