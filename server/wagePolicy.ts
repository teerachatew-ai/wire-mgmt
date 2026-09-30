import { prepare } from './db';

/* ── กติกาค่าแรง + ค่าปรับงานเสีย (แหล่งเดียวของทุกหน้าที่คิดเงินสมาชิก) ─────────────
   ชนิดงานตอนรับคืน
     • งานดี (good_qty)         — จ่ายเต็ม · เก็บรวม "งานแก้ไข" ไว้ด้วย (งานแก้ไขคือของดีที่ส่งโรงงานได้)
     • งานแก้ไข (rework_qty)    — เป็นส่วนหนึ่งของงานดี แต่หักค่าแรง X% (ตั้งค่า rework_deduct_percent)
     • NG โรงงาน (ng_factory)   — จ่ายเต็ม ไม่มีค่าปรับ (ไม่ใช่ความผิดสมาชิก)
     • NG ตัดโดนสายไฟ (ng_cut)        — ตัดขาด/ตัดพลาดเอง · ค่าแรงตาม defect_wage_percent · มีค่าปรับขั้นบันได
     • NG ดึงเชือก (ng_rope)    — ค่าแรงแบบเดียวกับ NG ตัดโดนสายไฟ · ค่าปรับอีกอัตรา (ng_rope_rate) ทุกครั้ง
   defect_qty = ng_cut + ng_factory + ng_rope (สต็อก/ส่งออกใช้ยอดนี้เป็นของเสีย)

   ค่าปรับ (นับต่อสมาชิก ต่อรอบค่าแรง รีเซ็ตทุกเดือน)
     รอบตั้งแต่ ng_policy_from:
       NG ตัดโดนสายไฟ นับ "ครั้ง" ตามวันที่รับคืนที่มี NG ตัดโดนสายไฟ (คืนหลายชนิดวันเดียวกัน = ครั้งเดียว)
         ครั้งที่ 1 = ตักเตือน (ไม่หักเงิน) · ครั้งที่ 2 = ng_group_rate_2 บาท/เส้น · ครั้งที่ 3 ขึ้นไป = ng_group_rate_3 บาท/เส้น
       NG ดึงเชือก = ng_rope_rate บาท/เส้น ทุกครั้ง
     รอบก่อนหน้านั้น: กติกาเดิม "NG เกินเกณฑ์" (เกิน defect_tolerance% × ng_penalty_per_unit) — ไม่แตะของอดีต
   คิดค่าปรับ "ต่อรายการรับคืน" ได้ทั้งหมด จึงรวมย่อยตามสินค้า/วันที่ แล้วบวกกันได้เท่ายอดรวมเป๊ะ */

export type WagePolicy = {
  defectPct: number;   // ค่าแรงของ NG ตัดโดนสายไฟ/NG ดึงเชือก (สัดส่วนของค่าแรงเต็ม)
  reworkPct: number;   // หักค่าแรงงานแก้ไข (สัดส่วนของค่าแรงเต็ม)
  legacyRate: number;  // กติกาเดิม: บาท/เส้นที่เกินเกณฑ์
  groupRate2: number;  // NG ตัดโดนสายไฟ ครั้งที่ 2 (บาท/เส้น)
  groupRate3: number;  // NG ตัดโดนสายไฟ ครั้งที่ 3 ขึ้นไป (บาท/เส้น)
  ropeRate: number;    // NG ดึงเชือก (บาท/เส้น)
  policyFrom: string;  // รอบค่าแรงแรกที่ใช้กติกาใหม่ (YYYY-MM)
};

export const DEFAULT_POLICY_FROM = '2026-09';   // ผู้ใช้กำหนด: มีผลตั้งแต่รอบค่าแรง ก.ย. 2569 เป็นต้นไป

export function loadWagePolicy(cfg?: Record<string, any>): WagePolicy {
  const c = cfg ?? Object.fromEntries((prepare(`SELECT key, value FROM settings`).all() as any[]).map((s: any) => [s.key, s.value]));
  const num = (k: string, d: number) => { const v = parseFloat(c[k]); return isFinite(v) ? v : d; };
  return {
    defectPct: num('defect_wage_percent', 0) / 100,
    reworkPct: num('rework_deduct_percent', 0) / 100,
    legacyRate: num('ng_penalty_per_unit', 20),
    groupRate2: num('ng_group_rate_2', 0),
    groupRate3: num('ng_group_rate_3', 0),
    ropeRate: num('ng_rope_rate', 0),
    policyFrom: /^\d{4}-\d{2}$/.test(String(c.ng_policy_from || '')) ? String(c.ng_policy_from) : DEFAULT_POLICY_FROM,
  };
}

/** ค่าแรง (ก่อนหักค่าปรับ) ต่อรายการรับคืน — ใช้ใน SQL ที่มี alias r (returns) และ p (products)
    ต้องส่งพารามิเตอร์ 2 ตัวตามลำดับ: wageParams(policy) */
export const WAGE_SQL = `((r.good_qty + r.ng_factory + r.lost_qty) * p.wage_per_unit
  + (r.ng_cut + COALESCE(r.ng_rope, 0)) * p.wage_per_unit * ?
  - COALESCE(r.rework_qty, 0) * p.wage_per_unit * ?)`;
export const wageParams = (pol: WagePolicy) => [pol.defectPct, pol.reworkPct];

/** ค่าแรง (ก่อนหักค่าปรับ) ต่อรายการรับคืน — ฝั่ง TS (สูตรเดียวกับ WAGE_SQL) */
export function returnWage(r: any, wagePerUnit: number, pol: WagePolicy): number {
  const w = Number(wagePerUnit) || 0;
  const n = (k: string) => Number(r[k]) || 0;
  return (n('good_qty') + n('ng_factory') + n('lost_qty')) * w
    + (n('ng_cut') + n('ng_rope')) * w * pol.defectPct
    - n('rework_qty') * w * pol.reworkPct;
}

export type PenaltyRow = {
  id: number; member_id: number; pay_cycle: string; date: string; product_name: string;
  ng_cut: number; ng_rope: number;
  legacy: boolean;
  legacy_excess: number;        // กติกาเดิม: เส้นที่เกินเกณฑ์
  group_tier: number | null;    // กติกาใหม่: NG ตัดโดนสายไฟ ครั้งที่เท่าไหร่ของรอบนั้น
  group_rate: number;
  amount: number;               // ค่าปรับของรายการนี้ (บาท)
};

/** ค่าปรับรายรายการรับคืน — กรองตามรอบ/สมาชิกได้ (ไม่ตัดกลางกลุ่ม สมาชิก+รอบ จึงนับครั้งถูกเสมอ) */
export function computePenalties(pol: WagePolicy, filter: { cycle?: string | null; memberId?: number | null } = {}): PenaltyRow[] {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.cycle) { where.push('r.pay_cycle = ?'); params.push(filter.cycle); }
  if (filter.memberId) { where.push('i.member_id = ?'); params.push(filter.memberId); }
  const rows = prepare(`
    SELECT r.id, i.member_id, r.pay_cycle, substr(r.returned_at, 1, 10) d, r.good_qty, r.ng_cut,
      COALESCE(r.ng_rope, 0) ng_rope, p.defect_tolerance tol, p.name product_name
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE (r.ng_cut > 0 OR COALESCE(r.ng_rope, 0) > 0)${where.length ? ' AND ' + where.join(' AND ') : ''}
    ORDER BY i.member_id, r.pay_cycle, d, r.id`).all(...params) as any[];

  const out: PenaltyRow[] = [];
  let groupKey = '';
  let tierOfDate = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.member_id}|${r.pay_cycle}`;
    if (key !== groupKey) { groupKey = key; tierOfDate = new Map(); }
    const ngCut = Number(r.ng_cut) || 0;
    const ngRope = Number(r.ng_rope) || 0;
    const legacy = !r.pay_cycle || String(r.pay_cycle) < pol.policyFrom;
    const row: PenaltyRow = {
      id: r.id, member_id: r.member_id, pay_cycle: r.pay_cycle, date: r.d, product_name: r.product_name,
      ng_cut: ngCut, ng_rope: ngRope, legacy, legacy_excess: 0, group_tier: null, group_rate: 0, amount: 0,
    };
    if (legacy) {
      // เหมือน SQL เดิมเป๊ะ: MAX(0, ng_cut − ROUND(tol/100 × (good + ng_cut))) — ถ้า tol เป็น NULL ใน SQL ได้ 0
      if (r.tol !== null && r.tol !== undefined) {
        const allowed = Math.round((Number(r.tol) / 100) * ((Number(r.good_qty) || 0) + ngCut));
        row.legacy_excess = Math.max(0, ngCut - allowed);
      }
      row.amount = row.legacy_excess * pol.legacyRate;
    } else {
      if (ngCut > 0) {
        if (!tierOfDate.has(r.d)) tierOfDate.set(r.d, tierOfDate.size + 1);
        const tier = tierOfDate.get(r.d)!;
        row.group_tier = tier;
        row.group_rate = tier <= 1 ? 0 : tier === 2 ? pol.groupRate2 : pol.groupRate3;
      }
      row.amount = ngCut * row.group_rate + ngRope * pol.ropeRate;
    }
    out.push(row);
  }
  return out;
}

/** รวมค่าปรับตามคีย์ที่ต้องการ เช่น สมาชิก (ต่อรอบเดียว) หรือ สมาชิก|รอบ */
export function sumPenalties(rows: PenaltyRow[], keyOf: (r: PenaltyRow) => string | number): Map<string | number, number> {
  const m = new Map<string | number, number>();
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) || 0) + r.amount);
  return m;
}

export type DeductionLine = { label: string; amount: number; note?: string };

const dm = (d: string) => { const [, mo, da] = String(d).split('-'); return `${Number(da)}/${Number(mo)}`; };
const fmtN = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

/** บรรทัดหักเงินสำหรับใบเสร็จ/หน้าสรุปค่าแรง ของสมาชิกหนึ่งคนในรอบเดียว */
export function deductionLines(rows: PenaltyRow[], pol: WagePolicy): DeductionLine[] {
  if (rows.length === 0) return [];
  const lines: DeductionLine[] = [];
  if (rows[0].legacy) {
    const excess = rows.reduce((s, r) => s + r.legacy_excess, 0);
    if (excess > 0 && pol.legacyRate > 0) {
      lines.push({ label: `หัก NG เกินเกณฑ์ (${fmtN(excess)} เส้น × ${fmtN(pol.legacyRate)} บาท)`, amount: excess * pol.legacyRate });
    }
    return lines;
  }
  // NG ตัดโดนสายไฟ — รวมตามครั้ง (วันที่)
  const byTier = new Map<number, { date: string; qty: number; rate: number }>();
  for (const r of rows) {
    if (r.group_tier === null) continue;
    const t = byTier.get(r.group_tier) || { date: r.date, qty: 0, rate: r.group_rate };
    t.qty += r.ng_cut;
    byTier.set(r.group_tier, t);
  }
  for (const [tier, t] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    if (tier === 1 || t.rate <= 0) {
      lines.push({ label: `NG ตัดโดนสายไฟ ครั้งที่ ${tier} (${dm(t.date)}) ${fmtN(t.qty)} เส้น — ${tier === 1 ? 'ตักเตือน' : 'ยังไม่ได้ตั้งอัตราค่าปรับ'}`, amount: 0, note: 'warn' });
    } else {
      lines.push({ label: `หัก NG ตัดโดนสายไฟ ครั้งที่ ${tier} (${dm(t.date)}) ${fmtN(t.qty)} เส้น × ${fmtN(t.rate)} บาท`, amount: t.qty * t.rate });
    }
  }
  const rope = rows.reduce((s, r) => s + r.ng_rope, 0);
  if (rope > 0) {
    lines.push(pol.ropeRate > 0
      ? { label: `หัก NG ดึงเชือก ${fmtN(rope)} เส้น × ${fmtN(pol.ropeRate)} บาท`, amount: rope * pol.ropeRate }
      : { label: `NG ดึงเชือก ${fmtN(rope)} เส้น — ยังไม่ได้ตั้งอัตราค่าปรับ`, amount: 0, note: 'warn' });
  }
  return lines;
}
