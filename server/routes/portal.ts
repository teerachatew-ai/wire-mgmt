import { Router } from 'express';
import { prepare } from '../db';
import { loadCutoffConfig, computePayCycle, payCycleWindow, todayThai } from '../payCycle';

const router = Router();

function getMemberByToken(token: string) {
  return prepare(`SELECT * FROM members WHERE portal_token = ?`).get(token) as any;
}

// จำนวนชิ้นที่นับเป็น "1 ชุด" ต่อโครงการ (project) — ป้ายขาว/ป้ายชมพู คือ 1 ชุด = สั้น+ยาว (2 ชิ้น)
// 3 สาย คือ 1 ชุด = 3 เส้น (1 ชิ้นต่อรุ่นย่อยทั้ง 3 รุ่นในกลุ่ม) — โครงการอื่นนอกเหนือจากนี้ไม่แปลงหน่วย
const PROJECT_SET_SIZE: Record<string, number> = { COT091: 2, COT092: 2, COT102: 3 };
const PROJECT_CHIP_LABEL: Record<string, string> = { COT091: 'ป้ายขาว', COT092: 'ป้ายชมพู', COT102: '3 สาย' };
// ลำดับคอลัมน์ที่สมาชิกคุ้นเคย — ป้ายขาวก่อน ป้ายชมพู แล้ว 3 สายไว้ขวาสุด (โครงการอื่นที่ไม่รู้จักจะถูกเรียงไว้ท้ายสุด)
const PROJECT_ORDER: Record<string, number> = { COT091: 0, COT092: 1, COT102: 2 };

// สรุปรายได้โดยประมาณ + จำนวนที่ตัด ของสมาชิกคนนี้ในรอบตัดค่าแรงปัจจุบัน — นับเฉพาะรายการคืนที่เจ้าหน้าที่ยืนยันแล้ว (ตาราง returns)
// เท่านั้น ไม่รวมคำขอที่ยังรอตรวจสอบ ใช้สูตรเดียวกับ /reports/payroll-cumulative (หักค่าปรับ NG-เกินเกณฑ์ + ปัดขึ้นเต็มบาท) เพื่อให้ตรงกับยอดที่เจ้าหน้าที่เห็น
function currentCycleSummary(memberId: number) {
  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const cfg = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const ngPenaltyRate = parseFloat(cfg.ng_penalty_per_unit || '20');
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(settings);
  const today = todayThai();
  const cycle = computePayCycle(today, holidays, overrides, cutoffDay);
  const { start, end } = payCycleWindow(cycle, holidays, overrides, cutoffDay);

  const totals = prepare(`
    SELECT
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?), 0) as gross_wage,
      COALESCE(SUM(MAX(0, r.ng_cut - ROUND(p.defect_tolerance / 100.0 * (r.good_qty + r.ng_cut)))), 0) as ng_excess_qty,
      COALESCE(SUM(r.good_qty), 0) as total_qty
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.pay_cycle = ?
  `).get(defectWagePct, memberId, cycle) as any;
  const wage = Math.max(0, Math.ceil(totals.gross_wage - totals.ng_excess_qty * ngPenaltyRate));

  const byProduct = prepare(`
    SELECT p.id as product_id, p.project, COALESCE(SUM(r.good_qty), 0) as good_qty
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.pay_cycle = ?
    GROUP BY p.id
  `).all(memberId, cycle) as any[];
  const qtyByProduct = new Map<number, number>(byProduct.map((r: any) => [r.product_id, r.good_qty]));

  const allProducts = prepare(`SELECT id, project, color FROM products WHERE active = 1`).all() as any[];
  const projectProducts = new Map<string, any[]>();
  for (const p of allProducts) {
    if (!p.project) continue;
    if (!projectProducts.has(p.project)) projectProducts.set(p.project, []);
    projectProducts.get(p.project)!.push(p);
  }

  const breakdown: any[] = [];
  for (const [project, setSize] of Object.entries(PROJECT_SET_SIZE)) {
    const prods = projectProducts.get(project) || [];
    if (prods.length < setSize) continue;
    const qtys = prods.map((p: any) => qtyByProduct.get(p.id) || 0);
    if (qtys.every((q: number) => q === 0)) continue;
    breakdown.push({ project, label: PROJECT_CHIP_LABEL[project] || project, color: prods[0].color, sets: Math.min(...qtys) });
  }

  return { cycle, start, end, total_qty: totals.total_qty, wage, breakdown };
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
    current_cycle: currentCycleSummary(member.id),
  });
});

// สมาชิกส่งคำขอคืนงานเอง — ยังไม่ใช่ยอดจริง รอเจ้าหน้าที่ตรวจนับของจริงแล้วกดยืนยันก่อนถึงจะมีผลจริง
router.post('/:token/return-request', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });

  const { issue_id, good_qty, ng_cut, ng_factory, waste_qty, lost_qty, notes, returned_at } = req.body;
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

  const retAt = returned_at || todayThai();
  const result = prepare(
    `INSERT INTO return_requests (issue_id, good_qty, ng_cut, ng_factory, waste_qty, lost_qty, notes, returned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(issue_id, gQty, ngCut, ngFac, wQty, lQty, notes || null, retAt);

  res.json({ ok: true, id: result.lastInsertRowid });
});

// สมาชิกส่งคำขอเบิกงานเอง — ยังไม่ใช่ใบเบิกจริง รอเจ้าหน้าที่ตรวจสอบแล้วกดยืนยันก่อนถึงจะเป็นใบเบิกจริง
router.post('/:token/issue-request', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });
  if (member.status !== 'active') return res.status(400).json({ error: 'บัญชีสมาชิกถูกพักสถานะ ติดต่อเจ้าหน้าที่' });

  const { product_id, quantity, notes, issued_at } = req.body;
  const product = prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(product_id) as any;
  if (!product) return res.status(400).json({ error: 'ไม่พบสินค้านี้' });

  const qty = parseFloat(quantity) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'กรุณาระบุจำนวน' });

  const issuedAt = issued_at || todayThai();
  const result = prepare(
    `INSERT INTO issue_requests (member_id, product_id, quantity, notes, issued_at) VALUES (?, ?, ?, ?, ?)`
  ).run(member.id, product_id, qty, notes || null, issuedAt);

  res.json({ ok: true, id: result.lastInsertRowid });
});

// สรุปจำนวนงานที่ตัด (ไม่แสดงค่าแรง) ของสมาชิกคนนี้ ในรอบตัดค่าแรงปัจจุบัน — ให้สมาชิกดูเองผ่านลิงก์พอร์ทัล
router.get('/:token/cutting-summary', (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).json({ error: 'ไม่พบข้อมูล ลิงก์อาจไม่ถูกต้อง' });

  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(settings);
  const today = todayThai();
  const cycle = computePayCycle(today, holidays, overrides, cutoffDay);
  const { start, end } = payCycleWindow(cycle, holidays, overrides, cutoffDay);

  // จัดกลุ่มตาม "วันที่เบิก" (issued_at) ไม่ใช่วันที่รับคืน — งานหนึ่งชิ้นมีทั้งวันเบิกและวันคืน ให้ยึดวันเบิกเป็นหลักตามที่สมาชิกคุ้นเคย
  const rows = prepare(`
    SELECT i.issued_at as issued_at, p.id as product_id, p.name as product_name, p.color, p.unit,
      SUM(r.good_qty) as good_qty
    FROM returns r
    JOIN issues i ON r.issue_id = i.id
    JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.pay_cycle = ?
    GROUP BY i.issued_at, p.id
    ORDER BY i.issued_at, p.id
  `).all(member.id, cycle) as any[];

  const productMap = new Map<number, any>();
  for (const r of rows) {
    if (!productMap.has(r.product_id)) productMap.set(r.product_id, { id: r.product_id, name: r.product_name, color: r.color, unit: r.unit });
  }
  // เรียงคอลัมน์: ป้ายขาว -> ป้ายชมพู -> 3 สาย (ใช้ project ของสินค้าจริงจากตาราง products อ้างอิง PROJECT_ORDER)
  const productProjectMap = new Map<number, string | null>(
    (prepare(`SELECT id, project FROM products`).all() as any[]).map((p: any) => [p.id, p.project])
  );
  const products = Array.from(productMap.values()).sort((a: any, b: any) => {
    const pa = PROJECT_ORDER[productProjectMap.get(a.id) || ''] ?? 99;
    const pb = PROJECT_ORDER[productProjectMap.get(b.id) || ''] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });

  res.json({ cycle, start, end, rows, products });
});

export default router;
