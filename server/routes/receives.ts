import { Router } from 'express';
import { prepare, nextCode } from '../db';
import { userOf } from '../reqUser';

const router = Router();

router.get('/', (req, res) => {
  const { product_id, from, to, date } = req.query;
  let sql = `SELECT r.*, p.name as product_name, p.unit, p.color, p.project FROM receives r JOIN products p ON r.product_id = p.id WHERE 1=1`;
  const params: any[] = [];
  if (product_id) { sql += ` AND r.product_id = ?`; params.push(product_id); }
  if (date) { sql += ` AND r.received_at LIKE ?`; params.push(`${date}%`); }
  if (from) { sql += ` AND r.received_at >= ?`; params.push(from); }
  if (to) { sql += ` AND r.received_at <= ?`; params.push(to); }
  sql += ` ORDER BY r.received_at DESC, r.id DESC`;
  res.json(prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { received_at, product_id, quantity, factory_ref, notes } = req.body;
  if (!received_at || !product_id || !quantity) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  const code = nextCode('RC', 'receives');
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
