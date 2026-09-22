import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';
import { deliveryCutoffRange } from '../payCycle';
import { STOCK_CUTOFF } from '../stockConfig';
import { lotVariances, lotKey } from '../receivedActual';

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
    return { ...r, counted_qty: r.actual_qty ?? null, variance_qty,
             actual_qty: (Number(r.quantity) || 0) + variance_qty };
  }));
});

/* ยอดคงเหลือรายล็อต (ใช้ตอนเลือกล็อตในใบเบิกด้วย — ใบเบิกที่ระบุล็อตแล้วหักจากล็อตนั้นตรงๆ
   ส่วนใบเบิกเก่าที่ไม่ได้ระบุล็อต หักแบบ FIFO จากล็อตเก่าสุดไล่มา ไม่งั้นล็อตเก่าจะค้างเต็มจำนวนตลอด)
   ยอดคงเหลือรายล็อต (สินค้า + วันที่รับ) ตั้งแต่ STOCK_CUTOFF — เรียงเก่า -> ใหม่ (FIFO)
   ใช้ทั้งตอนเลือกล็อตในใบเบิก และตอน "นับของหน้างาน" (ดู POST /count-waiting)
   ผลรวม remaining_qty ของทุกล็อต = ยอด "รอแจกจ่าย" ในหน้าสต็อกพอดี */
function lotsOf(productId?: number) {
  const where = productId ? ` AND product_id = ${productId}` : '';
  const recv = prepare(`
    SELECT product_id, substr(received_at,1,10) as lot_date, SUM(quantity) as received_qty
    FROM receives WHERE received_at >= ?${where} GROUP BY product_id, lot_date
  `).all(STOCK_CUTOFF) as any[];
  const tagged = prepare(`
    SELECT product_id, lot_date, SUM(quantity) as v
    FROM issues WHERE lot_date IS NOT NULL AND lot_date >= ?${where} GROUP BY product_id, lot_date
  `).all(STOCK_CUTOFF) as any[];
  const untagged = prepare(`
    SELECT product_id, SUM(quantity) as v
    FROM issues WHERE lot_date IS NULL AND issued_at >= ?${where} GROUP BY product_id
  `).all(STOCK_CUTOFF) as any[];

  const variances = lotVariances();
  const taggedOf = new Map(tagged.map(r => [`${r.product_id}|${r.lot_date}`, Number(r.v) || 0]));
  const untaggedLeft = new Map(untagged.map(r => [r.product_id, Number(r.v) || 0]));

  const byProduct = new Map<number, any[]>();
  for (const r of recv) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }

  const out: any[] = [];
  for (const [pid, rows] of byProduct) {
    rows.sort((a, b) => String(a.lot_date).localeCompare(String(b.lot_date)));   // เก่าสุดก่อน (FIFO)
    for (const r of rows) {
      // ใช้ "ยอดรับจริง" ของล็อต (ใบส่งของ + ที่นับได้เอง/สมาชิกแจ้ง) ให้ตรงกับยอดรอแจกจ่ายในหน้าสต็อก
      const received_qty = (Number(r.received_qty) || 0) + (variances.get(lotKey(pid, r.lot_date)) || 0);
      const issued_tagged = taggedOf.get(`${pid}|${r.lot_date}`) || 0;
      const capacity = Math.max(0, received_qty - issued_tagged);
      const pool = untaggedLeft.get(pid) || 0;
      const issued_untagged = Math.min(capacity, pool);        // เบิกเก่าที่ไม่ได้ระบุล็อต กินจากล็อตเก่าก่อน
      untaggedLeft.set(pid, pool - issued_untagged);
      out.push({
        product_id: pid, lot_date: r.lot_date, received_qty,
        received_note_qty: Number(r.received_qty) || 0,
        issued_qty: issued_tagged + issued_untagged,
        remaining_qty: capacity - issued_untagged,
      });
    }
  }
  return out;
}

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

  const applyToLot = (lotDate: string, amount: number) => {
    const rows = prepare(`SELECT * FROM receives WHERE product_id = ? AND substr(received_at,1,10) = ? ORDER BY id DESC`)
      .all(productId, lotDate) as any[];
    if (rows.length === 0) return;
    const target = rows[0];   // ล็อตหนึ่งอาจมีหลายใบ — ลงส่วนต่างไว้ที่ใบล่าสุดใบเดียว
    const before = Number(target.actual_qty ?? target.quantity) || 0;
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
      if (take > 0) { applyToLot(lot.lot_date, -take); left -= take; }
    }
    delta = -(-delta - left);   // ตัดได้จริงเท่าไหร่ (ปกติได้ครบ เพราะผลรวมล็อต = ยอดรอแจกจ่าย)
  } else if (delta > 0) {
    applyToLot(lots[lots.length - 1].lot_date, delta);
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
