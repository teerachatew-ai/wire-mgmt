import { Router } from 'express';
import { prepare, nextCode } from '../db';

const router = Router();

router.get('/', (_req, res) => {
  res.json(prepare(`SELECT * FROM products ORDER BY code`).all());
});

router.post('/', (req, res) => {
  const { name, project, unit, wage_per_unit, factory_price, defect_tolerance, color, description } = req.body;
  if (!name || !unit) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  const code = nextCode('P', 'products');
  const result = prepare(`INSERT INTO products (code, name, project, unit, wage_per_unit, factory_price, defect_tolerance, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, project || null, unit, wage_per_unit || 0, factory_price || 0, defect_tolerance ?? 5.0, color || null, description || null);
  res.json(prepare(`SELECT * FROM products WHERE id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, project, unit, wage_per_unit, factory_price, defect_tolerance, active, code, color, description } = req.body;
  if (code) {
    prepare(`UPDATE products SET code=?, name=?, project=?, unit=?, wage_per_unit=?, factory_price=?, defect_tolerance=?, active=?, color=?, description=? WHERE id=?`)
      .run(code, name, project || null, unit, wage_per_unit, factory_price || 0, defect_tolerance, active ?? 1, color || null, description || null, req.params.id);
  } else {
    prepare(`UPDATE products SET name=?, project=?, unit=?, wage_per_unit=?, factory_price=?, defect_tolerance=?, active=?, color=?, description=? WHERE id=?`)
      .run(name, project || null, unit, wage_per_unit, factory_price || 0, defect_tolerance, active ?? 1, color || null, description || null, req.params.id);
  }
  res.json(prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const product = prepare(`SELECT * FROM products WHERE id = ?`).get(id) as any;
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  // มีประวัติใช้งานไหม
  const used =
    (prepare(`SELECT COUNT(*) c FROM issues WHERE product_id = ?`).get(id) as any).c +
    (prepare(`SELECT COUNT(*) c FROM receives WHERE product_id = ?`).get(id) as any).c +
    (prepare(`SELECT COUNT(*) c FROM shipment_items WHERE product_id = ?`).get(id) as any).c;

  if (used > 0 && req.query.force !== '1') {
    return res.status(409).json({
      confirm_required: true,
      message: `สินค้านี้มีประวัติใช้งาน ${used} รายการ (เบิก/รับ/ส่งออก) — แนะนำให้ "ปิดใช้งาน" แทนการลบ เพื่อรักษาประวัติ`,
    });
  }

  prepare(`DELETE FROM products WHERE id = ?`).run(id);
  res.json({ deleted: true, code: product.code });
});

export default router;
