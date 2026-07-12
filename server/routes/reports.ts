import { Router } from 'express';
import { prepare } from '../db';
import { computePayCycle, loadCutoffConfig } from '../payCycle';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const router = Router();

// Windows ใช้ "python", Linux (cloud) ใช้ "python3"
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// รายได้จาก Amphenol ของเดือน (ยอดรับจริงถ้ามี × ราคาโรงงาน)
function monthRevenueOf(month: string): number {
  return (prepare(`SELECT COALESCE(SUM(COALESCE(si.received_qty, si.good_qty) * p.factory_price),0) v
    FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id JOIN products p ON si.product_id=p.id
    WHERE s.shipped_at LIKE ?`).get(`${month}%`) as any).v || 0;
}
// ค่าตอบแทนผู้บริหารของเดือน — ถ้ากำหนดเองใน manager_month ใช้ค่านั้น มิฉะนั้นคิดอัตโนมัติ
function managerCompForMonth(month: string): any[] {
  const rev = monthRevenueOf(month);
  const managers = prepare(`SELECT * FROM managers WHERE active = 1 ORDER BY sort_order, id`).all() as any[];
  const ov = Object.fromEntries((prepare(`SELECT manager_id, amount FROM manager_month WHERE month = ?`).all(month) as any[]).map((r: any) => [r.manager_id, r.amount]));
  return managers.map((mg: any) => {
    const auto = mg.compensation_type === 'percent' ? rev * (mg.amount / 100) : mg.amount;
    const overridden = ov[mg.id] !== undefined;
    return { ...mg, auto, computed: overridden ? ov[mg.id] : auto, overridden };
  });
}

// ค่าแรงสมาชิกรวมตาม "รอบจ่าย" (pay_cycle) — ตรงกับหน้าสรุปค่าแรง (หักปรับ NG-เกินเกณฑ์ + ปัดขึ้นเต็มบาทต่อคน)
function payCycleWage(cycle: string | null): number {
  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const ngPenaltyRate = parseFloat(cfg.ng_penalty_per_unit || '20');
  const rows = prepare(`
    SELECT m.id,
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?), 0) as gross,
      COALESCE(SUM(MAX(0, r.ng_cut - ROUND(p.defect_tolerance / 100.0 * (r.good_qty + r.ng_cut)))), 0) as ng_excess
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id
    ${cycle ? 'WHERE r.pay_cycle = ?' : ''}
    GROUP BY m.id
  `).all(...(cycle ? [defectWagePct, cycle] : [defectWagePct])) as any[];
  return rows.reduce((s, r) => s + Math.ceil((r.gross || 0) - (r.ng_excess || 0) * ngPenaltyRate), 0);
}

router.get('/dashboard', (_req, res) => {
  const stock = prepare(`
    SELECT p.id, p.name, p.unit, p.code,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id),0) as total_received,
      COALESCE((SELECT SUM(quantity) FROM issues WHERE product_id = p.id),0) as total_issued,
      COALESCE((SELECT SUM(i2.quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i2.id),0))
        FROM issues i2 WHERE i2.product_id = p.id AND i2.status != 'closed'),0) as with_members,
      COALESCE((SELECT SUM(si.good_qty+si.defect_qty) FROM shipment_items si WHERE si.product_id = p.id),0) as total_shipped
    FROM products p WHERE p.active = 1
  `).all();

  const today = new Date().toISOString().split('T')[0];
  const overdue = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE status != 'closed' AND due_date < ?`).get(today) as any;
  const pending_issues = prepare(`SELECT COUNT(*) as cnt FROM issues WHERE status != 'closed'`).get() as any;
  const thisMonth = new Date().toISOString().substring(0, 7);
  const defect = prepare(`SELECT COALESCE(SUM(r.defect_qty),0) as d, COALESCE(SUM(r.good_qty+r.defect_qty),0) as t FROM returns r WHERE r.returned_at LIKE ?`).get(`${thisMonth}%`) as any;
  const members_with_work = prepare(`SELECT COUNT(DISTINCT member_id) as cnt FROM issues WHERE status != 'closed'`).get() as any;

  res.json({
    stock,
    overdue_count: overdue.cnt,
    pending_issues_count: pending_issues.cnt,
    defect_pct: defect.t > 0 ? ((defect.d / defect.t) * 100).toFixed(1) : '0.0',
    members_with_work: members_with_work.cnt
  });
});

// ── Performance dashboard: รายรับจาก Amphenol, ค่าแรง, กำไร, คุณภาพ ──────────
router.get('/performance', (req, res) => {
  const thisMonth = (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month))
    ? req.query.month
    : new Date().toISOString().substring(0, 7);
  const mk = `${thisMonth}%`;
  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const withholdingTaxPct = parseFloat(cfg.withholding_tax_percent || '3');

  // Per-product money performance
  const products = prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.factory_price, p.wage_per_unit,
      COALESCE((SELECT SUM(si.good_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id WHERE si.product_id=p.id),0) as shipped_good_all,
      COALESCE((SELECT SUM(si.good_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id WHERE si.product_id=p.id AND s.shipped_at LIKE ?),0) as shipped_good_month,
      COALESCE((SELECT SUM(COALESCE(si.received_qty, si.good_qty)) FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id WHERE si.product_id=p.id),0) as recv_good_all,
      COALESCE((SELECT SUM(COALESCE(si.received_qty, si.good_qty)) FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id WHERE si.product_id=p.id AND s.shipped_at LIKE ?),0) as recv_good_month,
      COALESCE((SELECT SUM(r.good_qty + r.ng_factory) FROM returns r JOIN issues i ON r.issue_id=i.id WHERE i.product_id=p.id),0) as ret_good_all,
      COALESCE((SELECT SUM(r.good_qty + r.ng_factory) FROM returns r JOIN issues i ON r.issue_id=i.id WHERE i.product_id=p.id AND r.returned_at LIKE ?),0) as ret_good_month,
      COALESCE((SELECT SUM(r.ng_cut) FROM returns r JOIN issues i ON r.issue_id=i.id WHERE i.product_id=p.id AND r.returned_at LIKE ?),0) as ret_defect_month,
      COALESCE((SELECT SUM(r.ng_cut) FROM returns r JOIN issues i ON r.issue_id=i.id WHERE i.product_id=p.id),0) as ret_ngcut_all,
      COALESCE((SELECT SUM(i.quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0))
        FROM issues i WHERE i.product_id=p.id AND i.status!='closed'),0) as with_members
    FROM products p WHERE p.active=1
  `).all(mk, mk, mk, mk) as any[];

  const rows = products.map((p: any) => {
    // รายรับคิดจาก "ยอดที่โรงงานรับจริง" (ถ้ายืนยันแล้ว) ให้ตรงกับใบแจ้งหนี้/ใบวางบิล
    const revenue_all   = p.recv_good_all * p.factory_price;
    const revenue_month = p.recv_good_month * p.factory_price;
    // ค่าจ้างตัดในภาพรวม คิดจาก "งานที่ส่งออก" (shipped × ค่าจ้าง/หน่วย) — เห็นกำไรขั้นต้นได้แม้ยังไม่บันทึกเบิก/รับคืน
    const wage_all      = p.shipped_good_all * p.wage_per_unit;
    const wage_month    = p.shipped_good_month * p.wage_per_unit;
    return {
      ...p, revenue_all, revenue_month, wage_all, wage_month,
      profit_month: revenue_month - wage_month,
      profit_all: revenue_all - wage_all,
    };
  });
  const sum = (k: string) => rows.reduce((s: number, r: any) => s + (r[k] || 0), 0);

  // Quality
  const q    = prepare(`SELECT COALESCE(SUM(good_qty),0) g, COALESCE(SUM(defect_qty),0) d FROM returns WHERE returned_at LIKE ?`).get(mk) as any;
  const qAll = prepare(`SELECT COALESCE(SUM(good_qty),0) g, COALESCE(SUM(defect_qty),0) d FROM returns`).get() as any;

  // Operational
  const today = new Date().toISOString().split('T')[0];
  const overdue       = (prepare(`SELECT COUNT(*) c FROM issues WHERE status!='closed' AND due_date<?`).get(today) as any).c;
  const pendingIssues = (prepare(`SELECT COUNT(*) c FROM issues WHERE status!='closed'`).get() as any).c;
  const membersWork   = (prepare(`SELECT COUNT(DISTINCT member_id) c FROM issues WHERE status!='closed'`).get() as any).c;
  const shippedMonth  = (prepare(`SELECT COALESCE(SUM(si.good_qty+si.defect_qty),0) v FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id WHERE s.shipped_at LIKE ?`).get(mk) as any).v;
  const activeMembers = (prepare(`SELECT COUNT(*) c FROM members WHERE status='active'`).get() as any).c;
  // แยกค่าใช้จ่าย: จ่ายให้สมาชิก/ผู้บริหาร → นับรวมค่าตอบแทนผู้บริหาร · ที่เหลือ (general) → ค่าบริหารจัดการ
  const expToCompMonth = (prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE month = ? AND paid_to_type IN ('member','manager')`).get(thisMonth) as any).v;
  const expToCompAll   = (prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE paid_to_type IN ('member','manager')`).get() as any).v;
  const expensesMonth = (prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE month = ? AND (paid_to_type IS NULL OR paid_to_type='general')`).get(thisMonth) as any).v;
  const expensesAll = (prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE (paid_to_type IS NULL OR paid_to_type='general')`).get() as any).v;

  // ประมาณการเดือนนี้ = งานที่มีอยู่พร้อมทำ = ยอดยกมาต้นเดือน (คงค้างในระบบจากเดือนก่อน) + รับเข้าในเดือนนี้
  // ยอดยกมา = รับเข้าสะสม − ส่งออกสะสม − สูญเสียสะสม (ก่อนเริ่มเดือน)  [สอดคล้องกับหน้าตรวจสอบสต้อค]
  const monthStart = `${thisMonth}-01`;
  const fcRows = prepare(`
    SELECT p.factory_price fp, p.wage_per_unit wp,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id AND received_at LIKE ?), 0) rm,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id), 0) ra,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id AND received_at < ?), 0) carry_recv,
      COALESCE((SELECT SUM(COALESCE(si.received_qty, si.good_qty) + si.defect_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND s.shipped_at < ?), 0) carry_ship,
      COALESCE((SELECT SUM(r.waste_qty) FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id AND r.returned_at < ?), 0) carry_waste
    FROM products p WHERE p.active = 1
  `).all(mk, monthStart, monthStart, monthStart) as any[];
  // งานพร้อมทำเดือนนี้ต่อชนิด = ยกมา (รับเข้าสะสม − ส่งออกสะสม) + รับเข้าเดือนนี้ (ไม่ติดลบ)
  const fcQtyMonth = (r: any) => Math.max(0, (r.carry_recv - r.carry_ship)) + r.rm;
  const fcRevenueMonth = fcRows.reduce((s, r) => s + fcQtyMonth(r) * r.fp, 0);
  const fcWageMonth = fcRows.reduce((s, r) => s + fcQtyMonth(r) * r.wp, 0);
  const fcRevenueAll = fcRows.reduce((s, r) => s + r.ra * r.fp, 0);
  const fcWageAll = fcRows.reduce((s, r) => s + r.ra * r.wp, 0);

  // ค่าแรงจ่ายสมาชิก อิงตาม "รอบจ่าย" (cut-off) ให้ตรงกับหน้าสรุปค่าแรง
  const wageMonthVal = payCycleWage(thisMonth);
  const wageAllVal = payCycleWage(null);
  const revMonthVal = sum('revenue_month');
  const revAllVal = sum('revenue_all');
  // ค่าตอบแทนผู้บริหาร: เดือนนี้ = ตามที่กำหนดรายเดือน (หรืออัตโนมัติ) + ค่าใช้จ่ายที่จ่ายให้สมาชิก/ผู้บริหาร · สะสม = รวมทุกเดือน
  const managerCompBaseMonth = managerCompForMonth(thisMonth).reduce((s, m) => s + (m.computed || 0), 0);
  const shipMonths = (prepare(`SELECT DISTINCT strftime('%Y-%m', shipped_at) m FROM shipments WHERE shipped_at IS NOT NULL AND shipped_at != ''`).all() as any[]).map(r => r.m);
  const managerCompBaseAll = shipMonths.reduce((s, m) => s + managerCompForMonth(m).reduce((a, x) => a + (x.computed || 0), 0), 0);
  const managerCompMonth = managerCompBaseMonth + expToCompMonth;
  const managerCompAll = managerCompBaseAll + expToCompAll;
  const taxRate = withholdingTaxPct / 100;
  const taxMonth = revMonthVal * taxRate;
  const taxAll = revAllVal * taxRate;
  // กำไรสุทธิสุดท้าย = รายรับ − ภาษี − ค่าแรง − ค่าตอบแทนผู้บริหาร − ค่าบริหารจัดการ
  const finalNetMonth = revMonthVal - taxMonth - wageMonthVal - managerCompMonth - expensesMonth;
  const finalNetAll = revAllVal - taxAll - wageAllVal - managerCompAll - expensesAll;

  // 6-month trend: revenue vs wage
  const revByMonth  = prepare(`SELECT strftime('%Y-%m', s.shipped_at) month, COALESCE(SUM(COALESCE(si.received_qty, si.good_qty)*p.factory_price),0) v FROM shipment_items si JOIN shipments s ON si.shipment_id=s.id JOIN products p ON si.product_id=p.id GROUP BY month`).all() as any[];
  // ค่าตัดในกราฟ = ค่าแรงตามรอบจ่าย (cut-off) ให้ตรงกับการ์ด/หน้าสรุปค่าแรง
  const revMap  = Object.fromEntries(revByMonth.map(r => [r.month, r.v]));
  const trend: any[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const revenue = revMap[m] || 0;
    const wage = payCycleWage(m);
    trend.push({ month: m, revenue, wage, profit: revenue - wage });
  }

  res.json({
    month: thisMonth,
    revenue_month: sum('revenue_month'),
    revenue_all: sum('revenue_all'),
    wage_month: wageMonthVal,
    wage_all: wageAllVal,
    profit_month: revMonthVal - wageMonthVal,
    profit_all: revAllVal - wageAllVal,
    quality_month_pct: (q.g + q.d) > 0 ? (q.g / (q.g + q.d)) * 100 : 0,
    defect_month_pct:  (q.g + q.d) > 0 ? (q.d / (q.g + q.d)) * 100 : 0,
    quality_all_pct:   (qAll.g + qAll.d) > 0 ? (qAll.g / (qAll.g + qAll.d)) * 100 : 0,
    shipped_units_month: shippedMonth,
    with_members_units: sum('with_members'),
    overdue_count: overdue,
    pending_issues_count: pendingIssues,
    members_with_work: membersWork,
    active_members: activeMembers,
    withholding_tax_pct: withholdingTaxPct,
    expenses_month: expensesMonth,
    expenses_all: expensesAll,
    net_profit_month: (revMonthVal - wageMonthVal) - expensesMonth,
    net_profit_all: (revAllVal - wageAllVal) - expensesAll,
    // ตัวหัก + กำไรสุทธิสุดท้าย
    tax_month: taxMonth,
    tax_all: taxAll,
    manager_comp_month: managerCompMonth,
    manager_comp_all: managerCompAll,
    final_net_month: finalNetMonth,
    final_net_all: finalNetAll,
    // ประมาณการจากงานรับเข้า
    forecast_revenue_month: fcRevenueMonth,
    forecast_wage_month: fcWageMonth,
    forecast_gross_month: fcRevenueMonth - fcWageMonth,
    forecast_revenue_all: fcRevenueAll,
    forecast_wage_all: fcWageAll,
    forecast_gross_all: fcRevenueAll - fcWageAll,
    products: rows,
    trend,
  });
});

router.get('/outstanding', (_req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const rows = prepare(`
    SELECT i.id, i.code, i.issued_at, i.due_date, i.quantity, i.status,
      m.code as member_code, m.name as member_name, m.phone,
      p.name as product_name, p.unit,
      COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0) as returned_total,
      i.quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i.id),0) as remaining
    FROM issues i JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id
    WHERE i.status != 'closed'
    ORDER BY i.due_date ASC
  `).all() as any[];
  res.json(rows.map(r => ({ ...r, is_overdue: r.due_date && r.due_date < today ? 1 : 0 })));
});

router.get('/payroll', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'กรุณาระบุช่วงวันที่' });
  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const defectWagePct = parseFloat(settings.find(s => s.key === 'defect_wage_percent')?.value || '0') / 100;

  const detail = prepare(`
    SELECT m.id as member_id, m.code as member_code, m.name as member_name,
      m.bank_name, m.bank_account, p.name as product_name, p.unit, p.wage_per_unit,
      COALESCE(SUM(r.good_qty),0) as good_qty, COALESCE(SUM(r.defect_qty),0) as defect_qty,
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit) + SUM(r.ng_cut) * p.wage_per_unit * ?,0) as wage
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id
    WHERE r.returned_at >= ? AND r.returned_at <= ?
    GROUP BY m.id, p.id ORDER BY m.code, p.name
  `).all(defectWagePct, from, to);

  const summary = prepare(`
    SELECT m.id as member_id, m.code as member_code, m.name as member_name, m.nickname as member_nickname, m.bank_name, m.bank_account,
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?),0) as total_wage
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN members m ON i.member_id = m.id JOIN products p ON i.product_id = p.id
    WHERE r.returned_at >= ? AND r.returned_at <= ?
    GROUP BY m.id ORDER BY m.code
  `).all(defectWagePct, from, to) as any[];
  // ค่าแรงสมาชิกปัดขึ้นเต็มบาท
  for (const s of summary) s.total_wage = Math.ceil(s.total_wage || 0);

  res.json({ detail, summary });
});

router.get('/member-history/:memberId', (req, res) => {
  const issues = prepare(`
    SELECT i.*, p.name as product_name, p.unit, p.wage_per_unit,
      COALESCE((SELECT SUM(good_qty) FROM returns WHERE issue_id=i.id),0) as good_qty,
      COALESCE((SELECT SUM(defect_qty) FROM returns WHERE issue_id=i.id),0) as defect_qty,
      COALESCE((SELECT SUM(waste_qty) FROM returns WHERE issue_id=i.id),0) as waste_qty
    FROM issues i JOIN products p ON i.product_id = p.id WHERE i.member_id = ? ORDER BY i.issued_at DESC
  `).all(req.params.memberId);

  const ds = prepare(`SELECT COALESCE(SUM(r.good_qty),0) as total_good, COALESCE(SUM(r.defect_qty),0) as total_defect
    FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.member_id = ?`).get(req.params.memberId) as any;

  const defect_pct = ds.total_good + ds.total_defect > 0
    ? (ds.total_defect / (ds.total_good + ds.total_defect) * 100).toFixed(1) : '0.0';

  res.json({ issues, defect_summary: { ...ds, defect_pct } });
});

// รายละเอียดงานของสมาชิกใน "รอบจ่าย" (pay_cycle) หนึ่ง — ให้ตรงกับค่าแรงที่แสดง
// รอบจ่ายคิดจากวันรับคืน + วัน cut-off (งานที่คืนปลายเดือนก่อนหลัง cut-off จะถูกนับเข้ารอบเดือนนี้)
router.get('/member-paycycle/:memberId', (req, res) => {
  const cycle = typeof req.query.cycle === 'string' && /^\d{4}-\d{2}$/.test(req.query.cycle) ? req.query.cycle : '';
  if (!cycle) return res.json({ rows: [], byProduct: [] });
  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const rows = prepare(`
    SELECT r.id, r.code as return_code, r.returned_at, r.good_qty, r.ng_cut, r.ng_factory, r.lost_qty, r.waste_qty,
      i.code as issue_code, i.issued_at, p.name as product_name, p.unit, p.color, p.wage_per_unit,
      ((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?) as wage
    FROM returns r
    JOIN issues i ON r.issue_id = i.id
    JOIN products p ON i.product_id = p.id
    WHERE i.member_id = ? AND r.pay_cycle = ?
    ORDER BY r.returned_at, i.code
  `).all(defectWagePct, req.params.memberId, cycle) as any[];
  // สรุปต่อประเภทงาน
  const g: Record<string, any> = {};
  for (const r of rows) {
    const k = r.product_name;
    (g[k] ??= { name: k, color: r.color, unit: r.unit, good: 0, wage: 0 });
    g[k].good += Number(r.good_qty) || 0;
    g[k].wage += Number(r.wage) || 0;
  }
  res.json({ rows, byProduct: Object.values(g) });
});

router.get('/stock-reconcile', (_req, res) => {
  res.json(prepare(`
    SELECT p.code, p.name, p.unit,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id),0) as total_received,
      COALESCE((SELECT SUM(quantity) FROM issues WHERE product_id = p.id),0) as total_issued,
      COALESCE((SELECT SUM(si.good_qty+si.defect_qty) FROM shipment_items si WHERE si.product_id = p.id),0) as total_shipped,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id),0)
        - COALESCE((SELECT SUM(quantity) FROM issues WHERE product_id = p.id),0) as in_stock,
      COALESCE((SELECT SUM(i2.quantity - COALESCE((SELECT SUM(good_qty+defect_qty+waste_qty+lost_qty) FROM returns WHERE issue_id=i2.id),0))
        FROM issues i2 WHERE i2.product_id=p.id AND i2.status != 'closed'),0) as with_members
    FROM products p WHERE p.active = 1
  `).all());
});

// ── Income chart (stacked bar) ────────────────────────────────────────────
router.get('/income-chart', (req, res) => {
  const months = Math.min(parseInt(req.query.months as string) || 12, 24);
  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const cfg = Object.fromEntries((settings as any[]).map((s: any) => [s.key, s.value]));

  const defectWagePct  = parseFloat(cfg.defect_wage_percent   || '0') / 100;
  const taxRate        = parseFloat(cfg.withholding_tax_percent|| '3') / 100;
  const groupFundPct   = parseFloat(cfg.group_deduction_percent|| '0') / 100;
  const adminCostPct   = parseFloat(cfg.admin_cost_percent     || '0') / 100;

  const managers = prepare(`SELECT * FROM managers WHERE active = 1`).all() as any[];

  const rows = prepare(`
    SELECT strftime('%Y-%m', r.returned_at) as month,
      COALESCE(SUM(r.good_qty * p.wage_per_unit + r.defect_qty * p.wage_per_unit * ?), 0) as gross
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(defectWagePct, months) as any[];

  // Sort ascending for chart
  rows.reverse();

  const data = rows.map((r: any) => {
    const gross       = r.gross;
    const tax         = gross * taxRate;
    const group_fund  = gross * groupFundPct;   // กำไรสุทธิ / กองสะสม
    const admin_cost  = gross * adminCostPct;   // ค่าบริหารจัดการ
    const manager_comp = managers.reduce((s: number, mg: any) => {
      return s + (mg.compensation_type === 'percent' ? gross * (mg.amount / 100) : mg.amount);
    }, 0);
    const member_net = Math.max(0, gross - tax - group_fund - admin_cost - manager_comp);
    return { month: r.month, gross, member_net, tax, manager_comp, admin_cost, group_fund };
  });

  res.json({
    data,
    rates: { taxRate: taxRate * 100, groupFundPct: groupFundPct * 100, adminCostPct: adminCostPct * 100 }
  });
});

// ── Stock flow / Check & Balance ──────────────────────────────────────────
// ── ใบวางบิล (Billing Note) — ดึงจากการส่งออก × ราคาโรงงาน ──
router.get('/billing', (req, res) => {
  const m = (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : '';
  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const whtRate = parseFloat(cfg.withholding_tax_percent || '3') / 100;

  const raw = m ? prepare(`
    SELECT si.id as item_id, s.id as shipment_id, s.code as shipment_code,
      s.shipped_at, s.notes as po, p.project as project, p.name as part_number, p.description as descr, p.color,
      si.good_qty as sent_qty, si.received_qty as received_qty,
      COALESCE(si.received_qty, si.good_qty) as quantity, p.unit, p.factory_price as price
    FROM shipment_items si
    JOIN shipments s ON si.shipment_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.shipped_at LIKE ? AND COALESCE(si.received_qty, si.good_qty) > 0
    ORDER BY s.shipped_at, p.project, p.name
  `).all(`${m}%`) as any[] : [];

  const lines = raw.map((r: any) => {
    const amount = (r.quantity || 0) * (r.price || 0);
    const wht = amount * whtRate;
    // Part Number = รหัสรุ่น ตัดคำอธิบายในวงเล็บออก เช่น "MA020-676_A (ป้ายขาวยาว)" -> "MA020-676_A"
    const part_number = (r.part_number || '').replace(/\s*[\(（].*$/, '').trim();
    // Description = รายละเอียดสินค้าในระบบ เช่น "9 Core Wire"
    const description = r.descr || '';
    return { ...r, part_number, description, wht, amount, net: amount - wht };
  });

  const months = (prepare(`SELECT DISTINCT substr(shipped_at,1,7) ym FROM shipments WHERE shipped_at IS NOT NULL AND shipped_at != '' ORDER BY ym DESC`).all() as any[]).map(r => r.ym);

  res.json({
    month: m || null,
    wht_rate: whtRate,
    ng_rate: parseFloat(cfg.bill_ng_rate || '100'),   // % ของราคาที่หักต่อชิ้น NG (100 = ไม่จ่ายชิ้น NG เลย)
    months,
    supplier: {
      name: cfg.bill_vender_name || '',
      code: cfg.bill_vender_code || 'TM013',
      address: cfg.bill_vender_address || '',
      contact: cfg.bill_contact || '',
      tel: cfg.bill_tel || '',
    },
    lines,
  });
});

// บันทึกยอด/วันที่ที่แก้ในหน้าวางบิล กลับไปยังรายการส่งของจริง (shipment history)
// -> จำนวน = อัปเดต "ยอดที่โรงงานรับจริง" (received_qty) ของ shipment_item นั้น
// -> วันที่ = อัปเดตวันที่ส่ง (shipped_at) ของใบส่งนั้น (กระทบทุกรายการในใบเดียวกัน)
router.put('/billing-sync', (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'ไม่มีรายการให้บันทึก' });
    let updatedQty = 0, updatedDate = 0, skipped = 0;
    for (const it of items) {
      const itemId = Number(it.item_id);
      if (!itemId) { skipped++; continue; }  // แถวที่เพิ่มเอง (ไม่ได้มาจากใบส่ง) ข้าม
      const row = prepare(`SELECT si.id, si.shipment_id, s.shipped_at FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.id = ?`).get(itemId) as any;
      if (!row) { skipped++; continue; }
      const q = Number(it.quantity);
      if (Number.isFinite(q) && q >= 0) {
        prepare(`UPDATE shipment_items SET received_qty = ? WHERE id = ?`).run(q, itemId);
        updatedQty++;
      }
      const dt = typeof it.deliveryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.deliveryDate) ? it.deliveryDate : '';
      if (dt && dt !== String(row.shipped_at).slice(0, 10)) {
        prepare(`UPDATE shipments SET shipped_at = ? WHERE id = ?`).run(dt, row.shipment_id);
        updatedDate++;
      }
    }
    res.json({ ok: true, updatedQty, updatedDate, skipped });
  } catch (e: any) {
    console.error('[billing-sync] error:', e);
    res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${e?.message || e}` });
  }
});

// Export ใบวางบิลเป็นไฟล์ Excel (.xlsx) จาก template จริง — เป๊ะ 100%
router.post('/billing-export', (req, res) => {
  const body = req.body || {};
  const month: string = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : '';
  if (!month) return res.status(400).json({ error: 'month required' });

  const root = process.cwd();
  const tpl = path.join(root, 'server', 'templates', 'billing-template.xlsx');
  const script = path.join(root, 'server', 'scripts', 'fill_billing.py');
  const wantPdf = req.query.format === 'pdf';
  const pdfScript = path.join(root, 'server', 'scripts', 'xlsx_to_pdf.ps1');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-'));
  const dataFile = path.join(tmpDir, 'data.json');
  const xlsxFile = path.join(tmpDir, `billing-${month}.xlsx`);
  const pdfFile = path.join(tmpDir, `billing-${month}.pdf`);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  fs.writeFileSync(dataFile, JSON.stringify({
    month,
    wht_rate: typeof body.wht_rate === 'number' ? body.wht_rate : 0.03,
    supplier: body.supplier || {},
    lines: Array.isArray(body.lines) ? body.lines : [],
  }), 'utf-8');

  const sendFile = (file: string, type: string, name: string) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const stream = fs.createReadStream(file);
    stream.pipe(res);
    stream.on('close', cleanup);
  };

  const fillArgs = [script, tpl, dataFile, xlsxFile];
  if (wantPdf) fillArgs.push('pdf'); // PDF: เหลือเฉพาะชีตฟอร์ม (ตัดหน้าตัวอย่างออก)
  const py = spawn(PYTHON, fillArgs, {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  let errOut = '';
  py.stderr.on('data', (c) => { errOut += c.toString(); });
  py.on('error', (e) => { cleanup(); res.status(500).json({ error: 'python spawn failed: ' + e.message }); });
  py.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(xlsxFile)) {
      cleanup();
      return res.status(500).json({ error: 'fill failed', detail: errOut });
    }
    if (!wantPdf) {
      return sendFile(xlsxFile, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `billing-${month}.xlsx`);
    }
    // แปลง xlsx -> pdf ให้หน้าตาเหมือน Excel เป๊ะ
    //  - Windows: ใช้ MS Excel (COM) ผ่าน PowerShell
    //  - Linux (cloud): ใช้ LibreOffice headless
    const isWin = process.platform === 'win32';
    const ps = isWin
      ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pdfScript, '-In', xlsxFile, '-Out', pdfFile])
      : spawn('libreoffice', ['--headless', '--calc', '--convert-to', 'pdf', '--outdir', tmpDir, xlsxFile]);
    let psErr = '';
    const killTimer = setTimeout(() => { try { ps.kill(); } catch {} }, 90000);
    ps.stderr.on('data', (c) => { psErr += c.toString(); });
    ps.on('error', (e) => { clearTimeout(killTimer); cleanup(); res.status(500).json({ error: 'pdf convert spawn failed: ' + e.message }); });
    ps.on('close', (pc) => {
      clearTimeout(killTimer);
      // LibreOffice ตั้งชื่อไฟล์เป็น <ชื่อเดียวกับ xlsx>.pdf ใน outdir -> ใช้ pdfFile ที่ตั้งไว้ตรงกันแล้ว
      if (!fs.existsSync(pdfFile)) {
        cleanup();
        return res.status(500).json({ error: 'pdf convert failed', detail: psErr });
      }
      sendFile(pdfFile, 'application/pdf', `billing-${month}.pdf`);
    });
  });
});

// Export ใบแจ้งหนี้ (Invoice) — รวมยอดต่อสินค้าทั้งเดือน, ออกบิลให้ลูกค้า
router.post('/invoice-export', (req, res) => {
  const body = req.body || {};
  const month: string = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : '';
  if (!month) return res.status(400).json({ error: 'month required' });
  const [yy, mm] = month.split('-');

  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));

  // รวมยอดส่งออกต่อสินค้าในเดือนนั้น
  const rows = prepare(`
    SELECT p.project, p.name, p.description, p.factory_price as price, SUM(COALESCE(si.received_qty, si.good_qty)) as quantity
    FROM shipment_items si
    JOIN shipments s ON si.shipment_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.shipped_at LIKE ? AND COALESCE(si.received_qty, si.good_qty) > 0
    GROUP BY p.id
    ORDER BY p.project, p.name
  `).all(`${month}%`) as any[];

  let lines = rows.map((r: any) => ({
    project: r.project || '',
    part_number: (r.name || '').replace(/\s*[\(（].*$/, '').trim(),
    description: r.description || (r.name || '').replace(/\s*[\(（].*$/, '').trim(),
    quantity: r.quantity || 0,
    price: r.price || 0,
  }));

  // ถ้าหน้าวางบิลส่งรายการที่แก้แล้วมา (เช่น หัก NG) -> รวมยอดต่อสินค้าจากรายการนั้นแทน
  if (Array.isArray(body.lines_override) && body.lines_override.length) {
    const g: Record<string, any> = {};
    for (const l of body.lines_override) {
      const key = `${l.project || ''}|${l.part_number || ''}|${l.price || 0}`;
      if (!g[key]) g[key] = { project: l.project || '', part_number: l.part_number || '', description: l.description || l.part_number || '', quantity: 0, price: l.price || 0 };
      g[key].quantity += Number(l.quantity) || 0;
    }
    lines = Object.values(g).filter((l: any) => l.quantity > 0);
    lines.sort((a: any, b: any) => String(a.project).localeCompare(String(b.project)) || String(a.part_number).localeCompare(String(b.part_number)));
  }
  // ค่าขนส่ง (ถ้ากำหนดใน settings)
  const transport = parseFloat(cfg.invoice_transport_fee || '0');
  if (transport > 0) lines.push({ project: '', part_number: '', description: 'Transportation fee', quantity: 1, price: transport });

  const payload = {
    invoice_no: body.invoice_no || `${yy}${mm}01`,
    date: body.date || new Date().toISOString().slice(0, 10),
    customer: {
      name: cfg.invoice_customer_name || 'บริษัท แอมฟีนอล ฟีนิกซ์ (ประเทศไทย) จำกัด (สำนักงานใหญ่)',
      address: cfg.invoice_customer_address || '40/39-40,40/42-43 หมู่ที่ 5 ตำบลอุทัย อำเภออุทัย จังหวัดพระนครศรีอยุธยา 13210',
      contact: cfg.invoice_customer_contact || '',
      taxid: cfg.invoice_customer_taxid || '0145566000923',
    },
    lines,
  };

  const wantPdf = req.query.format === 'pdf';
  const isReceipt = req.query.doc === 'receipt';
  const docName = isReceipt ? 'receipt' : 'invoice';   // ใบเสร็จรับเงิน vs ใบแจ้งหนี้
  const root = process.cwd();
  const tpl = path.join(root, 'server', 'templates', `${docName}-template.xlsx`);
  const script = path.join(root, 'server', 'scripts', 'fill_invoice.py');
  const pdfScript = path.join(root, 'server', 'scripts', 'xlsx_to_pdf.ps1');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
  const dataFile = path.join(tmpDir, 'data.json');
  const xlsxFile = path.join(tmpDir, `${docName}-${month}.xlsx`);
  const pdfFile = path.join(tmpDir, `${docName}-${month}.pdf`);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  fs.writeFileSync(dataFile, JSON.stringify(payload), 'utf-8');

  const sendFile = (file: string, type: string, name: string) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const stream = fs.createReadStream(file);
    stream.pipe(res);
    stream.on('close', cleanup);
  };

  const args = [script, tpl, dataFile, xlsxFile];
  if (wantPdf) args.push('pdf', docName);  // docName: invoice | receipt (receipt = 2 หน้า ต้นฉบับ/คู่ฉบับ)
  const py = spawn(PYTHON, args, { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  let errOut = '';
  py.stderr.on('data', (c) => { errOut += c.toString(); });
  py.on('error', (e) => { cleanup(); res.status(500).json({ error: 'python spawn failed: ' + e.message }); });
  py.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(xlsxFile)) { cleanup(); return res.status(500).json({ error: 'fill failed', detail: errOut }); }
    if (!wantPdf) return sendFile(xlsxFile, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${docName}-${month}.xlsx`);
    const isWin = process.platform === 'win32';
    const ps = isWin
      ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pdfScript, '-In', xlsxFile, '-Out', pdfFile])
      : spawn('libreoffice', ['--headless', '--calc', '--convert-to', 'pdf', '--outdir', tmpDir, xlsxFile]);
    let psErr = '';
    const killTimer = setTimeout(() => { try { ps.kill(); } catch {} }, 90000);
    ps.stderr.on('data', (c) => { psErr += c.toString(); });
    ps.on('error', (e) => { clearTimeout(killTimer); cleanup(); res.status(500).json({ error: 'pdf convert spawn failed: ' + e.message }); });
    ps.on('close', () => {
      clearTimeout(killTimer);
      if (!fs.existsSync(pdfFile)) { cleanup(); return res.status(500).json({ error: 'pdf convert failed', detail: psErr }); }
      sendFile(pdfFile, 'application/pdf', `${docName}-${month}.pdf`);
    });
  });
});

function computeStockFlow(m: string) {
  const fRecv = m ? ` AND received_at LIKE '${m}%'` : '';
  const fIss  = m ? ` AND issued_at LIKE '${m}%'` : '';
  const fRet  = m ? ` AND r.returned_at LIKE '${m}%'` : '';
  const fShip = m ? ` AND s.shipped_at LIKE '${m}%'` : '';
  const monthStart = m ? `${m}-01` : '';
  // ยอดงานคงค้างในระบบ ก่อนเริ่มเดือน (ยกมา) = รับเข้าสะสม − ส่งออกสะสม − สูญเสียสะสม
  // "ส่งออก" ใช้ยอดที่โรงงานรับจริง (received_qty) ถ้ายืนยันแล้ว มิฉะนั้นใช้ยอดที่บันทึกส่ง (good_qty) + defect_qty
  const carrySel = m ? `,
      COALESCE((SELECT SUM(quantity) FROM receives WHERE product_id = p.id AND received_at < '${monthStart}'), 0) as carry_recv,
      COALESCE((SELECT SUM(COALESCE(si.received_qty, si.good_qty) + si.defect_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND s.shipped_at < '${monthStart}'), 0) as carry_ship,
      COALESCE((SELECT SUM(r.waste_qty) FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id AND r.returned_at < '${monthStart}'), 0) as carry_waste` : '';

  const products = prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.color, p.project,
      COALESCE((SELECT SUM(quantity)   FROM receives WHERE product_id = p.id${fRecv}), 0) as received,
      COALESCE((SELECT SUM(quantity)   FROM issues   WHERE product_id = p.id${fIss}), 0) as total_issued,
      COALESCE((SELECT SUM(r.good_qty)   FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_good,
      COALESCE((SELECT SUM(r.defect_qty) FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_defect,
      COALESCE((SELECT SUM(r.waste_qty)  FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_waste,
      COALESCE((SELECT SUM(r.ng_cut)     FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_ngcut,
      COALESCE((SELECT SUM(r.ng_factory) FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_ngfac,
      COALESCE((SELECT SUM(r.lost_qty)   FROM returns r JOIN issues i ON r.issue_id = i.id WHERE i.product_id = p.id${fRet}), 0) as ret_lost,
      COALESCE((SELECT SUM(COALESCE(si.received_qty, si.good_qty) + si.defect_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id${fShip}), 0) as shipped,
      COALESCE((SELECT SUM(si.good_qty + si.defect_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id${fShip}), 0) as shipped_recorded,
      COALESCE((SELECT SUM(si.received_qty - si.good_qty) FROM shipment_items si JOIN shipments s ON si.shipment_id = s.id WHERE si.product_id = p.id AND si.received_qty IS NOT NULL${fShip}), 0) as recv_diff${carrySel}
    FROM products p WHERE p.active = 1
  `).all() as any[];

  const rows = products.map(p => {
    if (m) {
      // โหมดเดือน: ยอดเคลื่อนไหว + งานคงค้างในระบบ (ยกมา/ยกไป)
      // ยอดคงเหลือ = รับเข้าสะสม − ส่งออกสะสม (เศษ/งานเสียเป็น byproduct ไม่หักจากยอดเส้น)
      const carry_ready = (p.carry_recv || 0) - (p.carry_ship || 0);                // ยกมาต้นเดือน (ทั้งระบบ)
      const closing_ready = carry_ready + (p.received - p.shipped);                 // ยกไปเดือนหน้า (ทั้งระบบ)
      // งานรอแจกจ่าย = รับเข้าเดือนนี้ − เบิกออกเดือนนี้ (ของที่รับเข้ามาในเดือนแต่ยังไม่ได้แจกให้สมาชิก)
      const wait_distribute = Math.max(0, (p.received || 0) - (p.total_issued || 0));
      return { ...p, in_warehouse: null, with_members: null, stock_ready: null, balance: null, ok: true, carry_ready, closing_ready, wait_distribute };
    }
    // ภาพรวมสะสม: แยก "ส่งออกตรงจากคลัง" (ช่วงข้อมูลย้อนหลังที่ส่งโดยไม่ผ่านเบิก/คืน) ออกจากสต๊อคพร้อมส่ง
    const retGD = p.ret_good + p.ret_defect;                       // คืนจากสมาชิก (ดี+เสีย)
    const direct = Math.max(0, p.shipped - retGD);                 // ส่งออกเกินกว่าที่คืนมา = ส่งตรงจากคลัง
    const in_warehouse = p.received - p.total_issued - direct;     // ในคลังรอเบิก (หักส่วนที่ส่งตรงออกไปแล้ว)
    const with_members = p.total_issued - (retGD + p.ret_waste + (p.ret_lost || 0));
    const stock_ready  = Math.max(0, retGD - p.shipped);           // คืนแล้วรอส่ง (ไม่ติดลบ)
    // ยอดคงเหลือพร้อมส่ง = รับเข้าสะสม − ส่งออกสะสม (ยกมา+รับเข้า−ส่งออก) — ไม่หักเศษ
    const available = p.received - p.shipped;
    const balance = p.received - in_warehouse - with_members - stock_ready - p.shipped - p.ret_waste - (p.ret_lost || 0);
    return { ...p, in_warehouse, with_members, stock_ready, available, balance,
      ok: in_warehouse >= 0 && with_members >= 0 && stock_ready >= 0 };
  });

  const incoming = prepare(`
    SELECT rv.received_at, rv.code, rv.factory_ref, rv.quantity,
      p.name as product_name, p.unit, p.code as product_code
    FROM receives rv JOIN products p ON rv.product_id = p.id
    ${m ? `WHERE rv.received_at LIKE '${m}%'` : ''}
    ORDER BY rv.received_at DESC, rv.id DESC LIMIT 200
  `).all();

  // เดือนที่มีข้อมูลจริง (สำหรับ dropdown filter)
  const months = (prepare(`
    SELECT DISTINCT ym FROM (
      SELECT substr(received_at,1,7) ym FROM receives
      UNION SELECT substr(issued_at,1,7) FROM issues
      UNION SELECT substr(returned_at,1,7) FROM returns
      UNION SELECT substr(shipped_at,1,7) FROM shipments
    ) WHERE ym IS NOT NULL AND ym != '' ORDER BY ym DESC
  `).all() as any[]).map(r => r.ym);

  return { products: rows, incoming, month: m || null, months };
}

router.get('/stock-flow', (req, res) => {
  const m = (typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : '';
  res.json(computeStockFlow(m));
});

// Export ตารางตรวจสอบสต็อค (Check & Balance) เป็นไฟล์ Excel
router.post('/stock-flow-export', (req, res) => {
  const body = req.body || {};
  const m = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : '';
  const data = computeStockFlow(m);

  const root = process.cwd();
  const script = path.join(root, 'server', 'scripts', 'stock_export.py');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-'));
  const dataFile = path.join(tmpDir, 'data.json');
  const xlsxFile = path.join(tmpDir, `stock-${m || 'all'}.xlsx`);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  fs.writeFileSync(dataFile, JSON.stringify(data), 'utf-8');

  const py = spawn(PYTHON, [script, dataFile, xlsxFile], {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  let errOut = '';
  py.stderr.on('data', (c) => { errOut += c.toString(); });
  py.on('error', (e) => { cleanup(); res.status(500).json({ error: 'python spawn failed: ' + e.message }); });
  py.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(xlsxFile)) { cleanup(); return res.status(500).json({ error: 'export failed', detail: errOut }); }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="stock-${m || 'all'}.xlsx"`);
    const stream = fs.createReadStream(xlsxFile);
    stream.pipe(res);
    stream.on('close', cleanup);
  });
});

// ── Monthly payroll with deductions ────────────────────────────────────────
router.get('/payroll-monthly', (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!month) return res.status(400).json({ error: 'กรุณาระบุเดือน (YYYY-MM)' });

  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const cfg = Object.fromEntries((settings as any[]).map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const groupDeductPct = parseFloat(cfg.group_deduction_percent || '0') / 100;

  const ngPenaltyRate = parseFloat(cfg.ng_penalty_per_unit || '20');

  const rawMembers = prepare(`
    SELECT m.id as member_id, m.code as member_code, m.name as member_name, m.nickname as member_nickname,
      m.bank_name, m.bank_account,
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?), 0) as gross_wage,
      COALESCE(SUM(r.ng_cut), 0) as ng_cut_qty,
      COALESCE(SUM(MAX(0, r.ng_cut - ROUND(p.defect_tolerance / 100.0 * (r.good_qty + r.ng_cut)))), 0) as ng_excess_qty
    FROM returns r
    JOIN issues i ON r.issue_id = i.id
    JOIN members m ON i.member_id = m.id
    JOIN products p ON i.product_id = p.id
    WHERE r.pay_cycle = ?
    GROUP BY m.id ORDER BY m.code
  `).all(defectWagePct, month) as any[];

  const members = rawMembers.map((m: any) => {
    const ng_deduction = m.ng_excess_qty * ngPenaltyRate;   // 20฿ ต่อเส้นที่เกินเกณฑ์
    // ค่าแรงสมาชิกปัดขึ้นเต็มบาท
    return { ...m, ng_deduction, total_wage: Math.ceil(m.gross_wage - ng_deduction) };
  });

  const total_wage = members.reduce((s: number, m: any) => s + m.total_wage, 0);
  const total_ng_deduction = members.reduce((s: number, m: any) => s + m.ng_deduction, 0);
  const group_deduction = total_wage * groupDeductPct;

  // รายได้ที่ได้รับจาก Amphenol ในเดือนนั้น (จากยอดส่งออก/รับจริง × ราคาที่โรงงานจ่าย)
  const monthRevenue = (prepare(`
    SELECT COALESCE(SUM(COALESCE(si.received_qty, si.good_qty) * p.factory_price), 0) as revenue
    FROM shipment_items si
    JOIN shipments s ON si.shipment_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.shipped_at LIKE ?
  `).get(`${month}%`) as any).revenue || 0;

  // ค่าตอบแทนผู้บริหาร — ใช้ค่ากำหนดรายเดือนถ้ามี ไม่งั้นคิดอัตโนมัติจากรายได้เดือนนั้น
  const managersWithComp = managerCompForMonth(String(month));
  const total_manager_comp = managersWithComp.reduce((s: number, m: any) => s + (m.computed || 0), 0);
  // เงินที่จ่ายสมาชิก = ค่าแรง − หักกองกลาง (ค่าตอบแทนผู้บริหารมาจากรายได้กลุ่ม ไม่หักจากค่าแรงสมาชิก)
  const net_payout = total_wage - group_deduction;

  res.json({
    month,
    members,
    total_wage,
    month_revenue: monthRevenue,
    total_ng_deduction,
    group_deduction_pct: groupDeductPct * 100,
    group_deduction,
    managers: managersWithComp,
    total_manager_comp,
    net_payout,
  });
});

// กำหนดค่าตอบแทนผู้บริหารรายเดือน (override) — ส่ง amount=null/'' เพื่อกลับไปใช้ค่าอัตโนมัติ
router.put('/manager-month', (req, res) => {
  const { month, manager_id, amount } = req.body || {};
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !manager_id) return res.status(400).json({ error: 'month/manager_id ไม่ถูกต้อง' });
  if (amount === null || amount === '' || amount === undefined) {
    prepare(`DELETE FROM manager_month WHERE month = ? AND manager_id = ?`).run(month, Number(manager_id));
    return res.json({ ok: true, cleared: true });
  }
  prepare(`DELETE FROM manager_month WHERE month = ? AND manager_id = ?`).run(month, Number(manager_id));
  prepare(`INSERT INTO manager_month (month, manager_id, amount) VALUES (?, ?, ?)`).run(month, Number(manager_id), Number(amount));
  res.json({ ok: true });
});

// ── Cumulative payroll per member (month-by-month) ─────────────────────────
router.get('/payroll-cumulative', (req, res) => {
  const settings = prepare(`SELECT key, value FROM settings`).all() as any[];
  const cfg = Object.fromEntries((settings as any[]).map((s: any) => [s.key, s.value]));
  const defectWagePct = parseFloat(cfg.defect_wage_percent || '0') / 100;
  const ngPenaltyRate = parseFloat(cfg.ng_penalty_per_unit || '20');

  // Monthly wage per member (net = ค่าแรง − ค่าปรับ NG เกินเกณฑ์)
  const rows = prepare(`
    SELECT m.id as member_id, m.code as member_code, m.name as member_name, m.nickname as member_nickname,
      r.pay_cycle as month,
      COALESCE(SUM((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit + r.ng_cut * p.wage_per_unit * ?), 0) as gross_wage,
      COALESCE(SUM(MAX(0, r.ng_cut - ROUND(p.defect_tolerance / 100.0 * (r.good_qty + r.ng_cut)))), 0) as ng_excess_qty
    FROM returns r
    JOIN issues i ON r.issue_id = i.id
    JOIN members m ON i.member_id = m.id
    JOIN products p ON i.product_id = p.id
    GROUP BY m.id, r.pay_cycle
    ORDER BY m.code, month
  `).all(defectWagePct) as any[];

  // Group by member
  const memberMap: Record<number, any> = {};
  for (const row of rows) {
    if (!memberMap[row.member_id]) {
      memberMap[row.member_id] = {
        member_id: row.member_id,
        member_code: row.member_code,
        member_name: row.member_name,
        member_nickname: row.member_nickname,
        total_wage: 0,
        months: []
      };
    }
    const wage = Math.ceil(row.gross_wage - (row.ng_excess_qty * ngPenaltyRate));   // ปัดขึ้นเต็มบาท
    memberMap[row.member_id].months.push({ month: row.month, wage });
    memberMap[row.member_id].total_wage += wage;
  }

  // All distinct months
  const allMonths = [...new Set(rows.map((r: any) => r.month))].sort();

  res.json({ members: Object.values(memberMap), all_months: allMonths });
});

// สรุปรายรับรายจ่าย (P&L) ของเดือน — สำหรับ export เป็นรายงาน Excel
function buildPL(month: string) {
  const cfg = Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const taxRate = parseFloat(cfg.withholding_tax_percent || '3') / 100;
  const revenue = monthRevenueOf(month);
  const wage = payCycleWage(month);
  const gross = revenue - wage;
  const tax = revenue * taxRate;
  const managerLines = managerCompForMonth(month).map((m: any) => ({ name: m.name, role: m.role || '', computed: m.computed || 0 }));
  const managerBase = managerLines.reduce((s, m) => s + m.computed, 0);
  const compExpLines = prepare(`SELECT description, paid_to_type, paid_to_name, amount FROM expenses WHERE month = ? AND paid_to_type IN ('member','manager') ORDER BY id`).all(month) as any[];
  const compExpTotal = compExpLines.reduce((s, e) => s + (e.amount || 0), 0);
  const generalExpLines = prepare(`SELECT description, amount FROM expenses WHERE month = ? AND (paid_to_type IS NULL OR paid_to_type='general') ORDER BY id`).all(month) as any[];
  const generalExpTotal = generalExpLines.reduce((s, e) => s + (e.amount || 0), 0);
  const managerComp = managerBase + compExpTotal;
  const net = revenue - tax - wage - managerComp - generalExpTotal;
  return {
    month, tax_pct: parseFloat(cfg.withholding_tax_percent || '3'),
    revenue, wage, gross, tax,
    manager_base: managerBase, manager_lines: managerLines,
    comp_exp_total: compExpTotal, comp_exp_lines: compExpLines,
    manager_comp: managerComp,
    general_exp_total: generalExpTotal, general_exp_lines: generalExpLines,
    net,
    org_name: cfg.bill_vender_name || 'วิสาหกิจชุมชนกลุ่มพัฒนาคุณภาพชีวิต ตำบลโคกม่วง',
  };
}

router.post('/pl-export', (req, res) => {
  const month = typeof req.body?.month === 'string' && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : '';
  if (!month) return res.status(400).json({ error: 'month required' });
  const data = buildPL(month);
  const root = process.cwd();
  const script = path.join(root, 'server', 'scripts', 'pl_export.py');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'));
  const dataFile = path.join(tmpDir, 'data.json');
  const xlsxFile = path.join(tmpDir, `pl-${month}.xlsx`);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  fs.writeFileSync(dataFile, JSON.stringify(data), 'utf-8');
  const py = spawn(PYTHON, [script, dataFile, xlsxFile], { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  let errOut = '';
  py.stderr.on('data', (c) => { errOut += c.toString(); });
  py.on('error', (e) => { cleanup(); res.status(500).json({ error: 'python spawn failed: ' + e.message }); });
  py.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(xlsxFile)) { cleanup(); return res.status(500).json({ error: 'export failed', detail: errOut }); }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pl-${month}.xlsx"`);
    const stream = fs.createReadStream(xlsxFile);
    stream.pipe(res);
    stream.on('close', cleanup);
  });
});

router.get('/settings', (_req, res) => {
  const rows = prepare(`SELECT key, value FROM settings`).all() as any[];
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// คำนวณ pay_cycle ของทุกรายการรับคืนใหม่ ตามตั้งค่าปัจจุบัน (เรียกหลังแก้วัน cut-off)
function recomputeAllPayCycles() {
  const cfg = prepare(`SELECT key, value FROM settings`).all() as any[];
  const { holidays, overrides, cutoffDay } = loadCutoffConfig(cfg);
  const rets = prepare(`SELECT id, returned_at FROM returns WHERE returned_at IS NOT NULL AND returned_at != ''`).all() as any[];
  let n = 0;
  for (const r of rets) {
    const pc = computePayCycle(String(r.returned_at), holidays, overrides, cutoffDay);
    prepare(`UPDATE returns SET pay_cycle = ? WHERE id = ?`).run(pc, r.id);
    n++;
  }
  return n;
}

router.put('/settings', (req, res) => {
  const affectsCutoff = Object.keys(req.body).some(k => k === 'pay_cutoff_day' || k === 'holidays' || k.startsWith('cutoff_'));
  for (const [key, value] of Object.entries(req.body)) {
    prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }
  let recomputed = 0;
  if (affectsCutoff) recomputed = recomputeAllPayCycles();
  res.json({ ok: true, recomputed });
});

router.post('/recompute-paycycles', (_req, res) => {
  res.json({ ok: true, recomputed: recomputeAllPayCycles() });
});

export default router;
