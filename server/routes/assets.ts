import { Router } from 'express';
import { prepare } from '../db';

const router = Router();

// รายการสินทรัพย์ + ยอดทยอยคืน + คงเหลือ
router.get('/', (_req, res) => {
  const rows = prepare(`
    SELECT a.*,
      COALESCE((SELECT SUM(amount) FROM asset_repayments WHERE asset_id = a.id), 0) as repaid
    FROM assets a ORDER BY a.purchase_date DESC, a.id DESC
  `).all() as any[];
  const list = rows.map((a: any) => ({
    ...a,
    owner_advanced: !!a.owner_advanced,
    remaining: a.owner_advanced ? Math.max(0, (a.price || 0) - (a.repaid || 0)) : 0,
  }));
  const totals = {
    total_price: list.reduce((s, a) => s + (a.price || 0), 0),
    total_advanced: list.filter(a => a.owner_advanced).reduce((s, a) => s + (a.price || 0), 0),
    total_repaid: list.reduce((s, a) => s + (a.repaid || 0), 0),
    total_remaining: list.reduce((s, a) => s + (a.remaining || 0), 0),
  };
  res.json({ assets: list, totals });
});

router.post('/', (req, res) => {
  const { name, price, purchase_date, owner_advanced, note } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อสินทรัพย์' });
  const r = prepare(`INSERT INTO assets (name, price, purchase_date, owner_advanced, note) VALUES (?, ?, ?, ?, ?)`)
    .run(name, Number(price) || 0, purchase_date || null, owner_advanced ? 1 : 0, note || null);
  res.json(prepare(`SELECT * FROM assets WHERE id = ?`).get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, price, purchase_date, owner_advanced, note } = req.body;
  prepare(`UPDATE assets SET name=?, price=?, purchase_date=?, owner_advanced=?, note=? WHERE id=?`)
    .run(name, Number(price) || 0, purchase_date || null, owner_advanced ? 1 : 0, note || null, req.params.id);
  res.json(prepare(`SELECT * FROM assets WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  prepare(`DELETE FROM asset_repayments WHERE asset_id = ?`).run(req.params.id);
  prepare(`DELETE FROM assets WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

// การทยอยคืนเงินของสินทรัพย์หนึ่ง ๆ
router.get('/:id/repayments', (req, res) => {
  res.json(prepare(`SELECT * FROM asset_repayments WHERE asset_id = ? ORDER BY paid_at DESC, id DESC`).all(req.params.id));
});

router.post('/:id/repayments', (req, res) => {
  const { amount, paid_at, note } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'กรุณากรอกจำนวนเงินที่คืน' });
  const r = prepare(`INSERT INTO asset_repayments (asset_id, amount, paid_at, note) VALUES (?, ?, ?, ?)`)
    .run(req.params.id, Number(amount), paid_at || null, note || null);
  res.json(prepare(`SELECT * FROM asset_repayments WHERE id = ?`).get(r.lastInsertRowid));
});

router.delete('/repayments/:rid', (req, res) => {
  prepare(`DELETE FROM asset_repayments WHERE id = ?`).run(req.params.rid);
  res.json({ deleted: true });
});

export default router;
