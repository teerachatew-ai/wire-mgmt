import { Router } from 'express';
import { prepare } from '../db';

const router = Router();

function getMemberByToken(token: string) {
  return prepare(`SELECT * FROM members WHERE portal_token = ?`).get(token) as any;
}

// ข้อมูลของสมาชิกคนนี้เอง — ใบเบิกที่ยังไม่ปิด + ประวัติคำขอคืนงานล่าสุด (ไม่ต้อง login ใช้โทเคนในลิงก์แทน)
router.get('/:token', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });

  const openIssues = prepare(`
    SELECT i.id, i.code, i.issued_at, i.quantity, p.name as product_name, p.color, p.unit,
      COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0) as returned_total,
      COALESCE((SELECT SUM(good_qty+ng_cut+ng_factory+waste_qty+lost_qty) FROM return_requests WHERE issue_id=i.id AND status='pending'),0) as pending_total
    FROM issues i JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND i.status != 'closed'
    ORDER BY i.issued_at DESC
  `).all(member.id) as any[];

  const recent = prepare(`
    SELECT rr.*, i.code as issue_code, p.name as product_name, p.color, p.unit
    FROM return_requests rr JOIN issues i ON rr.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ?
    ORDER BY rr.submitted_at DESC LIMIT 10
  `).all(member.id);

  const products = prepare(`SELECT id, name, unit, color, project FROM products WHERE active = 1 ORDER BY project, name`).all();

  const recentIssueRequests = prepare(`
    SELECT ir.*, p.name as product_name, p.color, p.unit
    FROM issue_requests ir JOIN products p ON ir.product_id = p.id
    WHERE ir.member_id = ?
    ORDER BY ir.submitted_at DESC LIMIT 10
  `).all(member.id);

  res.json({
    member: { code: member.code, name: member.name, nickname: member.nickname },
    open_issues: openIssues.map((i: any) => ({ ...i, remaining: i.quantity - i.returned_total - i.pending_total })),
    recent_requests: recent,
    products,
    recent_issue_requests: recentIssueRequests,
  });
});

// สมาชิกส่งคำขอคืนงานเอง — ยังไม่ใช่ยอดจริง รอเจ้าหน้าที่ตรวจนับของจริงแล้วกดยืนยันก่อนถึงจะมีผลจริง
router.post('/:token/return-request', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });

  const { issue_id, good_qty, ng_cut, ng_factory, waste_qty, lost_qty, notes } = req.body;
  const issue = prepare(`SELECT * FROM issues WHERE id = ? AND member_id = ?`).get(issue_id, member.id) as any;
  if (!issue) return res.status(400).json({ error: 'ไม่พบใบเบิกนี้' });
  if (issue.status === 'closed') return res.status(400).json({ error: 'ใบเบิกนี้ปิดแล้ว' });

  const gQty = Math.max(0, parseFloat(good_qty) || 0);
  const ngCut = Math.max(0, parseFloat(ng_cut) || 0);
  const ngFac = Math.max(0, parseFloat(ng_factory) || 0);
  const wQty = Math.max(0, parseFloat(waste_qty) || 0);
  const lQty = Math.max(0, parseFloat(lost_qty) || 0);
  if (gQty + ngCut + ngFac + wQty + lQty <= 0) return res.status(400).json({ error: 'กรุณาระบุจำนวน' });

  // เช็คเบื้องต้นไม่ให้แจ้งเกินยอดเบิก (กันพิมพ์ผิดเยอะเกิน) — ยอดจริงจะถูกตรวจ/ปรับอีกครั้งตอนเจ้าหน้าที่ยืนยัน
  const prevReturned = (prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as t FROM returns WHERE issue_id = ?`).get(issue_id) as any).t;
  const prevPending = (prepare(`SELECT COALESCE(SUM(good_qty+ng_cut+ng_factory+waste_qty+lost_qty),0) as t FROM return_requests WHERE issue_id = ? AND status='pending'`).get(issue_id) as any).t;
  const remaining = issue.quantity - prevReturned - prevPending;
  if (gQty + ngCut + ngFac + wQty + lQty > remaining + 0.001) {
    return res.status(400).json({ error: `แจ้งจำนวนเกินยอดที่เบิกไป (คงเหลือให้แจ้งได้ ${remaining})` });
  }

  const result = prepare(
    `INSERT INTO return_requests (issue_id, good_qty, ng_cut, ng_factory, waste_qty, lost_qty, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(issue_id, gQty, ngCut, ngFac, wQty, lQty, notes || null);

  res.json({ ok: true, id: result.lastInsertRowid });
});

// สมาชิกส่งคำขอเบิกงานเอง — ยังไม่ใช่ใบเบิกจริง รอเจ้าหน้าที่ตรวจสอบแล้วกดยืนยันก่อนถึงจะเป็นใบเบิกจริง
router.post('/:token/issue-request', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });
  if (member.status !== 'active') return res.status(400).json({ error: 'บัญชีสมาชิกถูกพักสถานะ ติดต่อเจ้าหน้าที่' });

  const { product_id, quantity, notes } = req.body;
  const product = prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(product_id) as any;
  if (!product) return res.status(400).json({ error: 'ไม่พบสินค้านี้' });

  const qty = parseFloat(quantity) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'กรุณาระบุจำนวน' });

  const result = prepare(
    `INSERT INTO issue_requests (member_id, product_id, quantity, notes) VALUES (?, ?, ?, ?)`
  ).run(member.id, product_id, qty, notes || null);

  res.json({ ok: true, id: result.lastInsertRowid });
});

export default router;
