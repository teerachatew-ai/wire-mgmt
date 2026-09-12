import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { userOf } from '../reqUser';
import { deliveryCutoffRange } from '../payCycle';
import { STOCK_CUTOFF } from '../stockConfig';

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

  /* จำนวนรับจริง = ยอดตามใบส่งของ + ส่วนต่างที่พบตอนแจกงาน
     ส่วนต่างมาเองจากการแก้ยอดใบเบิก (สมาชิกนับของในมัดแล้วมาแจ้งว่าขาด/เกิน เจ้าหน้าที่แก้ยอดเบิก)
     — เทียบ quantity ปัจจุบันกับ orig_quantity ที่บันทึกไว้ตอนแจกครั้งแรก แล้วผูกกลับมาที่ล็อตผ่าน lot_date
     ไม่ต้องกรอกยอดรับจริงเองเลย */
  const varRows = prepare(`
    SELECT product_id, lot_date, SUM(quantity - COALESCE(orig_quantity, quantity)) as v
    FROM issues WHERE lot_date IS NOT NULL GROUP BY product_id, lot_date
  `).all() as any[];
  const varOf = new Map(varRows.map(r => [`${r.product_id}|${r.lot_date}`, Number(r.v) || 0]));

  // ล็อตหนึ่ง (สินค้า+วันที่) อาจมีใบรับหลายใบ เช่นรอบที่ 1 / รอบที่ 2 ของวันเดียวกัน
  // ลงส่วนต่างของทั้งล็อตไว้ที่ใบล่าสุดใบเดียว เวลารวมทั้งคอลัมน์จะได้ไม่นับซ้ำ
  const lastIdOf = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.product_id}|${String(r.received_at).slice(0, 10)}`;
    if (!lastIdOf.has(k) || r.id > lastIdOf.get(k)!) lastIdOf.set(k, r.id);
  }
  res.json(rows.map(r => {
    const k = `${r.product_id}|${String(r.received_at).slice(0, 10)}`;
    const variance_qty = lastIdOf.get(k) === r.id ? (varOf.get(k) || 0) : 0;
    return { ...r, variance_qty, actual_qty: (Number(r.quantity) || 0) + variance_qty };
  }));
});

/* ล็อตที่รับเข้าจากโรงงาน แยกตามวันที่รับ พร้อมยอดคงเหลือที่ยังไม่ได้แจกให้สมาชิก
   ใช้ตอนสร้างใบเบิก — ให้เลือกได้ว่างานที่เบิกวันนี้ตัดมาจากล็อตวันไหน (เผื่อมีล็อตเก่าแจกไม่หมดค้างอยู่)

   ยอดคงเหลือรายล็อตคิดแบบนี้:
   • ใบเบิกที่ระบุล็อตไว้แล้ว (lot_date) → หักออกจากล็อตนั้นตรงๆ
   • ใบเบิกเก่าที่ยังไม่ได้ระบุล็อต → หักแบบ FIFO จากล็อตเก่าสุดไล่มา
     (ถ้าไม่ทำแบบนี้ ล็อตเก่าที่แจกหมดไปแล้วจะยังโชว์ว่าเหลือเต็มจำนวน เพราะใบเบิกยุคก่อนไม่มีล็อตผูกไว้)
   • นับเฉพาะตั้งแต่ STOCK_CUTOFF เป็นต้นมา ให้ผลรวมคงเหลือทุกล็อตเท่ากับยอด "รอแจกจ่าย" ในหน้าสต็อกพอดี */
router.get('/lots', (req, res) => {
  const productId = req.query.product_id ? parseInt(req.query.product_id as string, 10) : 0;
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
      const received_qty = Number(r.received_qty) || 0;
      const issued_tagged = taggedOf.get(`${pid}|${r.lot_date}`) || 0;
      const capacity = Math.max(0, received_qty - issued_tagged);
      const pool = untaggedLeft.get(pid) || 0;
      const issued_untagged = Math.min(capacity, pool);        // เบิกเก่าที่ไม่ได้ระบุล็อต กินจากล็อตเก่าก่อน
      untaggedLeft.set(pid, pool - issued_untagged);
      out.push({
        product_id: pid, lot_date: r.lot_date, received_qty,
        issued_qty: issued_tagged + issued_untagged,
        remaining_qty: capacity - issued_untagged,
      });
    }
  }
  res.json(out);
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

router.delete('/:id', (req, res) => {
  const rec = prepare(`SELECT * FROM receives WHERE id = ?`).get(req.params.id) as any;
  if (!rec) return res.status(404).json({ error: 'ไม่พบรายการรับของ' });
  prepare(`DELETE FROM receives WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true, code: rec.code });
});

export default router;
