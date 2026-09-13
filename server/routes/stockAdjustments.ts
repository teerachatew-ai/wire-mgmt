import { Router } from 'express';
import { prepare } from '../db';
import { userOf } from '../reqUser';

const router = Router();

/* ปรับยอดสต็อกด้วยมือ — ใช้เมื่อยอดคงเหลือในระบบ (สะสมทั้งหมด) ไม่ตรงกับของจริงหน้างาน
   เช่น ยอดผีที่ค้างมาจากการบันทึกรับเข้า/ส่งออกคลาดเคลื่อนช่วงแรกๆ ที่หาต้นตอไม่เจอแล้วว่าใบไหนผิด
   บันทึกเป็นรายการแยก ไม่ไปแก้ไขใบรับ/ใบส่งเดิม — ตรวจสอบย้อนหลังได้เสมอว่าใครปรับ เท่าไหร่ เพราะอะไร
   quantity: บวก = พบของเกินกว่าที่ระบบคิด, ลบ = พบของขาด/ตัดยอดผีทิ้ง
   มีผลเฉพาะยอดคงเหลือสะสม (พร้อมส่ง/ในคลัง) ในหน้าสต็อก — ไม่กระทบยอดค่าแรง/รายได้ที่คำนวณตามรอบ Cut-off */
router.get('/', (req, res) => {
  const { product_id } = req.query;
  let sql = `SELECT a.*, p.name as product_name, p.unit, p.color, p.project
    FROM stock_adjustments a JOIN products p ON a.product_id = p.id WHERE 1=1`;
  const params: any[] = [];
  if (product_id) { sql += ` AND a.product_id = ?`; params.push(product_id); }
  sql += ` ORDER BY a.adjusted_at DESC, a.id DESC`;
  res.json(prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { product_id, adjusted_at, quantity, reason } = req.body;
  if (!product_id || !adjusted_at || quantity === undefined || quantity === null || Number(quantity) === 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้า วันที่ และจำนวนที่จะปรับ (ต้องไม่เป็น 0)' });
  }
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ปรับยอด' });
  const product = prepare(`SELECT id FROM products WHERE id = ?`).get(product_id);
  if (!product) return res.status(400).json({ error: 'ไม่พบสินค้า' });

  const result = prepare(`INSERT INTO stock_adjustments (product_id, adjusted_at, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?)`)
    .run(product_id, adjusted_at, quantity, String(reason).trim(), userOf(req));
  res.json(prepare(`SELECT a.*, p.name as product_name, p.unit FROM stock_adjustments a JOIN products p ON a.product_id = p.id WHERE a.id = ?`).get(result.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const row = prepare(`SELECT * FROM stock_adjustments WHERE id = ?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการปรับยอด' });
  prepare(`DELETE FROM stock_adjustments WHERE id = ?`).run(req.params.id);
  res.json({ deleted: true });
});

export default router;
