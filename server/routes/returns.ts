import { Router } from 'express';
import { prepare, nextCode } from '../db';
import { computePayCycle, loadCutoffConfig } from '../payCycle';
import { userOf } from '../reqUser';

const router = Router();

function payCycleFor(returnedAt: string): string {
  const cfg = prepare(`SELECT key, value FROM settings`).all() as any[];
  const { holidays, overrides } = loadCutoffConfig(cfg);
  return computePayCycle(returnedAt, holidays, overrides);
}

function updateIssueStatus(issueId: number) {
  const issue = prepare(`SELECT quantity FROM issues WHERE id = ?`).get(issueId) as any;
  const rets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d, COALESCE(SUM(waste_qty),0) as w FROM returns WHERE issue_id = ?`).get(issueId) as any;
  const total = rets.g + rets.d + rets.w;
  let status = total >= issue.quantity ? 'closed' : total > 0 ? 'partial' : 'pending';
  prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(status, issueId);
  return { status, total };
}

router.get('/', (req, res) => {
  const { issue_id, date } = req.query;
  let sql = `SELECT r.*, i.code as issue_code, m.name as member_name, p.name as product_name, p.color as product_color FROM returns r
    JOIN issues i ON r.issue_id = i.id JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id WHERE 1=1`;
  const params: any[] = [];
  if (issue_id) { sql += ` AND r.issue_id = ?`; params.push(issue_id); }
  if (date) { sql += ` AND r.returned_at LIKE ?`; params.push(`${date}%`); }
  sql += ` ORDER BY r.returned_at DESC, r.id DESC`;
  res.json(prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { issue_id, returned_at, good_qty, ng_cut, ng_factory, defect_qty, waste_qty, inspector, notes } = req.body;
  if (!issue_id || !returned_at) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });

  const issue = prepare(`SELECT i.*, p.name as product_name, p.unit, p.defect_tolerance FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(issue_id) as any;
  if (!issue) return res.status(400).json({ error: 'ไม่พบใบเบิก' });
  if (issue.status === 'closed') return res.status(400).json({ error: 'ใบเบิกนี้ปิดแล้ว' });

  const gQty = parseFloat(good_qty) || 0;
  const ngCut = parseFloat(ng_cut) || 0;        // เสียจากการตัด (หักเงิน)
  const ngFac = parseFloat(ng_factory) || 0;    // เสียจากโรงงาน (จ่ายปกติ)
  // รองรับของเดิมที่ส่ง defect_qty มาเดี่ยวๆ -> นับเป็นเสียจากการตัด
  const dQty = (ngCut + ngFac) > 0 ? (ngCut + ngFac) : (parseFloat(defect_qty) || 0);
  const finalNgCut = (ngCut + ngFac) > 0 ? ngCut : dQty;
  const wQty = parseFloat(waste_qty) || 0;

  const prev = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty),0) as total FROM returns WHERE issue_id = ?`).get(issue_id) as any;
  const remaining = issue.quantity - (prev.total || 0);
  if (gQty + dQty + wQty > remaining + 0.001) {
    return res.status(400).json({ error: `คืนเกินจำนวน (คงเหลือ ${remaining} ${issue.unit})` });
  }

  const code = nextCode('RT', 'returns');
  const payCycle = payCycleFor(returned_at);
  const result = prepare(`INSERT INTO returns (code, issue_id, returned_at, good_qty, defect_qty, ng_cut, ng_factory, waste_qty, inspector, notes, pay_cycle, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, issue_id, returned_at, gQty, dQty, finalNgCut, ngFac, wQty, inspector || null, notes || null, payCycle, userOf(req));

  updateIssueStatus(parseInt(issue_id));

  const allRets = prepare(`SELECT COALESCE(SUM(good_qty),0) as g, COALESCE(SUM(defect_qty),0) as d FROM returns WHERE issue_id = ?`).get(issue_id) as any;
  const defectPct = allRets.g + allRets.d > 0 ? (allRets.d / (allRets.g + allRets.d)) * 100 : 0;
  const defectWarning = defectPct > issue.defect_tolerance ? `⚠️ ของเสีย ${defectPct.toFixed(1)}% เกินเกณฑ์ ${issue.defect_tolerance}%` : null;

  res.json({
    return: prepare(`SELECT * FROM returns WHERE id = ?`).get(result.lastInsertRowid),
    issue_status: issue.status,
    defect_warning: defectWarning
  });
});

router.put('/:id', (req, res) => {
  const { returned_at, good_qty, ng_cut, ng_factory, defect_qty, waste_qty, inspector, notes } = req.body;
  const ret = prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id) as any;
  if (!ret) return res.status(404).json({ error: 'ไม่พบรายการรับคืน' });
  if (!returned_at) return res.status(400).json({ error: 'กรุณากรอกวันที่' });

  const issue = prepare(`SELECT i.*, p.unit, p.defect_tolerance FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(ret.issue_id) as any;

  const gQty = parseFloat(good_qty) || 0;
  const ngCut = parseFloat(ng_cut) || 0;
  const ngFac = parseFloat(ng_factory) || 0;
  const dQty = (ngCut + ngFac) > 0 ? (ngCut + ngFac) : (parseFloat(defect_qty) || 0);
  const finalNgCut = (ngCut + ngFac) > 0 ? ngCut : dQty;
  const wQty = parseFloat(waste_qty) || 0;

  // จำนวนคืนรวมของใบเบิกนี้ ไม่นับรายการที่กำลังแก้ + จำนวนใหม่ ต้องไม่เกินจำนวนเบิก
  const others = prepare(`SELECT COALESCE(SUM(good_qty+defect_qty+waste_qty),0) as total FROM returns WHERE issue_id = ? AND id != ?`).get(ret.issue_id, req.params.id) as any;
  const remaining = issue.quantity - (others.total || 0);
  if (gQty + dQty + wQty > remaining + 0.001) {
    return res.status(400).json({ error: `คืนเกินจำนวน (คงเหลือ ${remaining} ${issue.unit})` });
  }

  const payCycle = payCycleFor(returned_at);
  prepare(`UPDATE returns SET returned_at=?, good_qty=?, defect_qty=?, ng_cut=?, ng_factory=?, waste_qty=?, inspector=?, notes=?, pay_cycle=? WHERE id=?`)
    .run(returned_at, gQty, dQty, finalNgCut, ngFac, wQty, inspector || null, notes || null, payCycle, req.params.id);

  updateIssueStatus(ret.issue_id);
  res.json({ return: prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id) });
});

router.delete('/:id', (req, res) => {
  const ret = prepare(`SELECT * FROM returns WHERE id = ?`).get(req.params.id) as any;
  if (!ret) return res.status(404).json({ error: 'ไม่พบรายการรับคืน' });
  prepare(`DELETE FROM returns WHERE id = ?`).run(req.params.id);
  updateIssueStatus(ret.issue_id);
  res.json({ deleted: true, code: ret.code });
});

export default router;
