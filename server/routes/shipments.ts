import { Router } from 'express';
import { prepare } from '../db';
import { userOf } from '../reqUser';

const router = Router();

// ── List shipments ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { from, to, date } = req.query as any;
  let sql = `SELECT s.id, s.code, s.shipped_at, s.notes, s.created_by,
    COALESCE((SELECT SUM(si.good_qty + si.defect_qty) FROM shipment_items si WHERE si.shipment_id = s.id),0) as total_qty
    FROM shipments s WHERE 1=1`;
  const params: any[] = [];
  if (date) { sql += ` AND s.shipped_at LIKE ?`; params.push(`${date}%`); }
  if (from) { sql += ` AND s.shipped_at >= ?`; params.push(from); }
  if (to)   { sql += ` AND s.shipped_at <= ?`; params.push(to); }
  sql += ` ORDER BY s.shipped_at DESC, s.id DESC`;

  const rows = prepare(sql).all(...params) as any[];
  const result = rows.map(s => ({
    ...s,
    items: prepare(`
      SELECT si.good_qty, si.defect_qty, si.received_qty, p.id as product_id, p.code as product_code, p.name as product_name, p.unit, p.color
      FROM shipment_items si JOIN products p ON si.product_id = p.id
      WHERE si.shipment_id = ?
    `).all(s.id)
  }));
  res.json(result);
});

// ── Create shipment ───────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { shipped_at, notes, items } = req.body;
  if (!shipped_at) return res.status(400).json({ error: 'กรุณาระบุวันที่ส่ง' });
  const validItems = (items || []).filter((it: any) => (it.good_qty || 0) + (it.defect_qty || 0) > 0);
  if (validItems.length === 0) return res.status(400).json({ error: 'กรุณาระบุปริมาณอย่างน้อย 1 รายการ' });

  // Generate code
  const cnt = (prepare(`SELECT COUNT(*) as c FROM shipments`).get() as any).c;
  const code = `SH${String(cnt + 1).padStart(3, '0')}`;

  prepare(`INSERT INTO shipments (code, shipped_at, notes, created_by) VALUES (?, ?, ?, ?)`).run(code, shipped_at, notes || null, userOf(req));
  const shipment = prepare(`SELECT * FROM shipments ORDER BY id DESC LIMIT 1`).get() as any;

  for (const it of validItems) {
    const recv = (it.received_qty === '' || it.received_qty == null) ? null : Number(it.received_qty);
    prepare(`INSERT INTO shipment_items (shipment_id, product_id, good_qty, defect_qty, received_qty) VALUES (?, ?, ?, ?, ?)`)
      .run(shipment.id, Number(it.product_id), Number(it.good_qty) || 0, Number(it.defect_qty) || 0, recv);
  }

  res.json({ ok: true, code, id: shipment.id });
});

// ── Update shipment ───────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { shipped_at, notes, items } = req.body;
  const ship = prepare(`SELECT * FROM shipments WHERE id = ?`).get(id) as any;
  if (!ship) return res.status(404).json({ error: 'ไม่พบรายการส่งออก' });
  if (!shipped_at) return res.status(400).json({ error: 'กรุณาระบุวันที่ส่ง' });
  const validItems = (items || []).filter((it: any) => (it.good_qty || 0) + (it.defect_qty || 0) > 0);
  if (validItems.length === 0) return res.status(400).json({ error: 'กรุณาระบุปริมาณอย่างน้อย 1 รายการ' });

  prepare(`UPDATE shipments SET shipped_at = ?, notes = ? WHERE id = ?`).run(shipped_at, notes || null, id);
  // แทนที่รายการสินค้าทั้งหมด
  prepare(`DELETE FROM shipment_items WHERE shipment_id = ?`).run(id);
  for (const it of validItems) {
    const recv = (it.received_qty === '' || it.received_qty == null) ? null : Number(it.received_qty);
    prepare(`INSERT INTO shipment_items (shipment_id, product_id, good_qty, defect_qty, received_qty) VALUES (?, ?, ?, ?, ?)`)
      .run(id, Number(it.product_id), Number(it.good_qty) || 0, Number(it.defect_qty) || 0, recv);
  }
  res.json({ ok: true, id, code: ship.code });
});

// ── Delete shipment ───────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM shipment_items WHERE shipment_id = ?`).run(Number(req.params.id));
  prepare(`DELETE FROM shipments WHERE id = ?`).run(Number(req.params.id));
  res.json({ deleted: true });
});

export default router;
