import { Router } from 'express';
import { prepare, nextDateCode } from '../db';
import { computePayCycle, loadCutoffConfig } from '../payCycle';
import { userOf } from '../reqUser';

const router = Router();

function payCycleFor(returnedAt: string): string {
  const cfg = prepare(`SELECT key, value FROM settings`).all() as any[];
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(cfg);
  return computePayCycle(returnedAt, holidays, overrides, cutoffDay);
}

function updateIssueStatus(issueId: number) {
  const issue = prepare(`SELECT quantity FROM issues WHERE id = ?`).get(issueId) as any;
  const rets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d, COALESCE(SUM(waste_qty),0) as w, COALESCE(SUM(lost_qty),0) as l FROM returns WHERE issue_id = ?`).get(issueId) as any;
  const total = rets.g + rets.d + rets.w + rets.l;
  const status = total >= issue.quantity ? 'closed' : total > 0 ? 'partial' : 'pending';
  prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(status, issueId);
}

// รายการคำขอคืนงานที่สมาชิกส่งเองผ่านลิงก์พอร์ทัล (ค่าเริ่มต้น = รอตรวจสอบ)
router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = `SELECT rr.*, i.code as issue_code, i.issued_at, i.quantity as issue_quantity, i.status as issue_status,
      m.id as member_id, m.code as member_code, m.name as member_name, m.nickname as member_nickname,
      p.name as product_name, p.color, p.unit
    FROM return_requests rr
    JOIN issues i ON rr.issue_id = i.id
    JOIN members m ON i.member_id = m.id
    JOIN products p ON i.product_id = p.id
    WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ` AND rr.status = ?`; params.push(status); }
  sql += ` ORDER BY rr.submitted_at ASC`;
  res.json(prepare(sql).all(...params));
});

// เจ้าหน้าที่ยืนยัน — ปรับยอดให้ตรงกับที่ตรวจนับจริงได้ก่อนยืนยัน (ไม่ส่งค่ามา = ใช้ยอดที่สมาชิกแจ้งไว้)
router.post('/:id/confirm', (req, res) => {
  const request = prepare(`SELECT * FROM return_requests WHERE id = ?`).get(req.params.id) as any;
  if (!request) return res.status(404).json({ error: 'ไม่พบคำขอ' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' });

  const issue = prepare(`SELECT i.*, p.unit FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(request.issue_id) as any;
  if (!issue) return res.status(400).json({ error: 'ไม่พบใบเบิก' });
  if (issue.status === 'closed') return res.status(400).json({ error: 'ใบเบิกนี้ปิดแล้ว' });

  const { good_qty, ng_cut, ng_factory, waste_qty, lost_qty, returned_at, inspector, notes } = req.body;
  const gQty = good_qty !== undefined ? (parseFloat(good_qty) || 0) : request.good_qty;
  const ngCut = ng_cut !== undefined ? (parseFloat(ng_cut) || 0) : request.ng_cut;
  const ngFac = ng_factory !== undefined ? (parseFloat(ng_factory) || 0) : request.ng_factory;
  const wQty = waste_qty !== undefined ? (parseFloat(waste_qty) || 0) : request.waste_qty;
  const lQty = lost_qty !== undefined ? (parseFloat(lost_qty) || 0) : request.lost_qty;
  const retAt = returned_at || request.returned_at || new Date().toISOString().split('T')[0];

  const prev = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty+lost_qty),0) as total FROM returns WHERE issue_id = ?`).get(request.issue_id) as any;
  const remaining = issue.quantity - (prev.total || 0);
  if (gQty + ngCut + ngFac + wQty + lQty > remaining + 0.001) {
    return res.status(400).json({ error: `ยืนยันเกินจำนวนที่เบิก (คงเหลือ ${remaining} ${issue.unit})` });
  }

  const code = nextDateCode('RT', 'returns', retAt);
  const payCycle = payCycleFor(retAt);
  const result = prepare(
    `INSERT INTO returns (code, issue_id, returned_at, good_qty, defect_qty, ng_cut, ng_factory, waste_qty, lost_qty, inspector, notes, pay_cycle, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, request.issue_id, retAt, gQty, ngCut + ngFac, ngCut, ngFac, wQty, lQty, inspector || null, notes || request.notes || null, payCycle, userOf(req));

  updateIssueStatus(request.issue_id);

  prepare(`UPDATE return_requests SET status='confirmed', confirmed_return_id=?, confirmed_at=datetime('now'), confirmed_by=? WHERE id=?`)
    .run(result.lastInsertRowid, userOf(req), req.params.id);

  res.json({ ok: true, return_id: result.lastInsertRowid });
});

router.post('/:id/reject', (req, res) => {
  const request = prepare(`SELECT * FROM return_requests WHERE id = ?`).get(req.params.id) as any;
  if (!request) return res.status(404).json({ error: 'ไม่พบคำขอ' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' });
  const { reason } = req.body;
  prepare(`UPDATE return_requests SET status='rejected', confirmed_at=datetime('now'), confirmed_by=?, reject_reason=? WHERE id=?`)
    .run(userOf(req), reason || null, req.params.id);
  res.json({ ok: true });
});

export default router;
