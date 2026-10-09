import { prepare } from './db';

/* ── กติกาค่าแรง + ค่าปรับงานเสีย (แหล่งเดียวของทุกหน้าที่คิดเงินสมาชิก) ─────────────
   ชนิดงานตอนรับคืน
     • งานดี (good_qty)            — จ่ายเต็ม · เก็บรวม "งานแก้ไข" ไว้ด้วย (งานแก้ไขคือของดีที่ส่งโรงงานได้)
     • งานแก้ไข (rework_qty)       — เป็นส่วนหนึ่งของงานดี แต่หักค่าแรง X% (ตั้งค่า rework_deduct_percent)
     • NG โรงงาน (ng_factory)      — จ่ายเต็ม ไม่มีค่าปรับ (ไม่ใช่ความผิดสมาชิก)
     • NG ตัดโดนสายไฟ (ng_cut)     — ค่าแรงตาม defect_wage_percent · มีค่าปรับขั้นบันได
     • NG ดึงเชือก (ng_rope)       — ค่าแรงแบบเดียวกับ NG ตัดโดนสายไฟ · ค่าปรับอีกอัตรา (ng_rope_rate)
   defect_qty = ng_cut + ng_factory + ng_rope (สต็อก/ส่งออกใช้ยอดนี้เป็นของเสีย)

   ค่าปรับ NG (ผู้ใช้กำหนด)
     มีผลกับงานจากล็อตที่โรงงานมาส่งตั้งแต่ 28 ส.ค. 2569 (EFFECTIVE_LOT_FROM)
       ล็อตของใบเบิก = lot_date ที่ติดไว้ ถ้าไม่ได้ติดใช้วันที่เบิก — ตรงกับระบบล็อต (receivedActual) ที่ถือว่า
       ใบเบิกตั้งแต่ 28 ส.ค. ทั้งหมดมาจากล็อตตั้งแต่ 28 ส.ค.
     นับ "ครั้ง" ต่อสมาชิก สะสมต่อเนื่อง (ไม่รีเซ็ตรายเดือน) นับรวม NG ตัดโดนสายไฟ + NG ดึงเชือก
       1 ครั้ง = งานที่เบิกไป "วันที่เบิกเดียวกัน" ที่คืนมามี NG (กี่เส้น กี่ชนิดงาน คืนกี่รอบ ก็ยังเป็นครั้งเดียว)
       เรียงลำดับครั้งตามวันที่รับคืนรายการแรกที่เจอ NG ของวันที่เบิกนั้น
     ครั้งที่ 1 = ตักเตือน (ไม่หักเงิน ทั้งสองชนิด)
     ครั้งที่ 2 = NG ตัดโดนสายไฟ × ng_group_rate_2 + NG ดึงเชือก × ng_rope_rate
     ครั้งที่ 3 ขึ้นไป = NG ตัดโดนสายไฟ × ng_group_rate_3 + NG ดึงเชือก × ng_rope_rate
     ค่าปรับหักในรอบค่าแรงของรายการรับคืนที่มี NG นั้น
     เกณฑ์ที่ยอมรับได้ (ng_cut_allow + ng_cut_allow_unit) — เฉพาะ NG ตัดโดนสายไฟ ต่อใบเบิก 1 ใบ
       percent: ยอมรับ floor(จำนวนเบิก × % ÷ 100) เส้น (เบิก 100 กรอก 1% = ยอมรับ 1 เส้น) · pieces: ยอมรับ N เส้นต่อใบเบิก
       ส่วนที่อยู่ในเกณฑ์ไม่ปรับและไม่นับครั้ง ใช้สิทธิ์ตามลำดับการคืน (คืนหลายรอบ ใช้เกณฑ์ของใบเดียวกันร่วมกัน)
       NG ดึงเชือกไม่มีเกณฑ์ยกเว้น (ปรับตามเดิม)
   งานจากล็อตก่อน 28 ส.ค.: กติกาเดิม "NG เกินเกณฑ์" (เกิน defect_tolerance% × ng_penalty_per_unit) — ไม่แตะของอดีต
   ค่าปรับคิด "ต่อรายการรับคืน" ได้ทั้งหมด จึงรวมย่อยตามสินค้า/วันที่ แล้วบวกกันได้เท่ายอดรวมเป๊ะ */

export const EFFECTIVE_LOT_FROM = '2026-08-28';

export type WagePolicy = {
  defectPct: number;   // ค่าแรงของ NG ตัดโดนสายไฟ/NG ดึงเชือก (สัดส่วนของค่าแรงเต็ม)
  reworkPct: number;   // หักค่าแรงงานแก้ไข (สัดส่วนของค่าแรงเต็ม)
  legacyRate: number;  // กติกาเดิม: บาท/เส้นที่เกินเกณฑ์
  groupRate2: number;  // NG ตัดโดนสายไฟ ครั้งที่ 2 (บาท/เส้น)
  groupRate3: number;  // NG ตัดโดนสายไฟ ครั้งที่ 3 ขึ้นไป (บาท/เส้น)
  ropeRate: number;    // NG ดึงเชือก ตั้งแต่ครั้งที่ 2 (บาท/เส้น)
  cutAllow: number;    // เกณฑ์ NG ตัดโดนสายไฟที่ยอมรับได้ต่อใบเบิก (0 = ไม่มีเกณฑ์)
  cutAllowUnit: 'percent' | 'pieces';
};

/** จำนวน NG ตัดโดนสายไฟที่ยอมรับได้ของใบเบิกหนึ่งใบ */
export const cutAllowanceOf = (pol: WagePolicy, issueQty: number) =>
  pol.cutAllow <= 0 ? 0 : pol.cutAllowUnit === 'pieces' ? Math.floor(pol.cutAllow) : Math.floor((Number(issueQty) || 0) * pol.cutAllow / 100 + 1e-9);

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
    cutAllow: Math.max(0, num('ng_cut_allow', 0)),
    cutAllowUnit: c.ng_cut_allow_unit === 'pieces' ? 'pieces' : 'percent',
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
  issue_date: string;           // วันที่เบิกของงานนี้ (ตัวแบ่ง "ครั้ง")
  ng_cut: number; ng_rope: number;
  ng_note?: string | null;      // รายละเอียด NG ที่กรอกตอนรับคืน (เช่น ตัดโดนอะไร)
  ng_cut_allowed: number;       // NG ตัดโดนสายไฟส่วนที่อยู่ในเกณฑ์ (ไม่ปรับ ไม่นับครั้ง)
  legacy: boolean;
  legacy_excess: number;        // กติกาเดิม: เส้นที่เกินเกณฑ์
  strike: number | null;        // กติกาใหม่: NG ครั้งที่เท่าไหร่ (สะสม) ของสมาชิกคนนี้
  cut_rate: number; rope_rate: number;
  amount: number;               // ค่าปรับของรายการนี้ (บาท)
};

/** รายการรับคืนสมมติ (ยังไม่บันทึก) สำหรับพรีวิวก่อนกดยืนยัน */
export type VirtualReturn = { issue_id: number; returned_at: string; ng_cut: number; ng_rope: number; good_qty?: number; ng_note?: string };

const tierRates = (pol: WagePolicy, strike: number) =>
  strike <= 1 ? { cut: 0, rope: 0 } : { cut: strike === 2 ? pol.groupRate2 : pol.groupRate3, rope: pol.ropeRate };

/** ค่าปรับรายรายการรับคืน — นับครั้งจากประวัติทั้งหมดเสมอ แล้วค่อยกรองรอบ/สมาชิกตอนส่งออก
    extra = รายการสมมติ (id ติดลบ) ใช้พรีวิว · excludeId = รายการที่กำลังแก้ไข (ไม่นับของเดิม) */
export function computePenalties(pol: WagePolicy,
  filter: { cycle?: string | null; memberId?: number | null } = {},
  extra: VirtualReturn[] = [], excludeId?: number): PenaltyRow[] {
  const base = prepare(`
    SELECT r.id, i.member_id, r.pay_cycle, substr(r.returned_at, 1, 10) d, r.good_qty, r.ng_cut,
      COALESCE(r.ng_rope, 0) ng_rope, p.defect_tolerance tol, p.name product_name,
      substr(i.issued_at, 1, 10) issue_date, COALESCE(i.lot_date, substr(i.issued_at, 1, 10)) lot,
      i.id issue_id, i.quantity issue_qty, r.ng_note
    FROM returns r JOIN issues i ON r.issue_id = i.id JOIN products p ON i.product_id = p.id
    WHERE (r.ng_cut > 0 OR COALESCE(r.ng_rope, 0) > 0)`).all() as any[];
  const rows = excludeId ? base.filter(r => r.id !== excludeId) : base;
  extra.forEach((v, k) => {
    if (!((Number(v.ng_cut) || 0) > 0 || (Number(v.ng_rope) || 0) > 0)) return;
    const i = prepare(`SELECT i.id, i.quantity, i.member_id, substr(i.issued_at, 1, 10) issue_date, COALESCE(i.lot_date, substr(i.issued_at, 1, 10)) lot,
      p.defect_tolerance tol, p.name product_name FROM issues i JOIN products p ON i.product_id = p.id WHERE i.id = ?`).get(v.issue_id) as any;
    if (!i) return;
    rows.push({ id: -(k + 1), member_id: i.member_id, pay_cycle: null, d: String(v.returned_at).slice(0, 10),
      good_qty: Number(v.good_qty) || 0, ng_cut: Number(v.ng_cut) || 0, ng_rope: Number(v.ng_rope) || 0,
      tol: i.tol, product_name: i.product_name, issue_date: i.issue_date, lot: i.lot, issue_id: i.id, issue_qty: i.quantity,
      ng_note: v.ng_note || null });
  });
  // ลำดับครั้ง: ตามวันที่รับคืน แล้วตามลำดับบันทึก (รายการสมมติต่อท้ายวันเดียวกัน)
  rows.sort((a, b) => a.member_id - b.member_id || String(a.d).localeCompare(String(b.d))
    || (a.id < 0 ? 1 : 0) - (b.id < 0 ? 1 : 0) || Math.abs(a.id) - Math.abs(b.id));

  const out: PenaltyRow[] = [];
  let member = -1;
  let strikeOf = new Map<string, number>();
  const allowLeft = new Map<number, number>();   // เกณฑ์ที่ยอมรับได้ที่ยังเหลือ ต่อใบเบิก
  for (const r of rows) {
    if (r.member_id !== member) { member = r.member_id; strikeOf = new Map(); }
    const ngCut = Number(r.ng_cut) || 0;
    const ngRope = Number(r.ng_rope) || 0;
    const legacy = String(r.lot) < EFFECTIVE_LOT_FROM;
    const row: PenaltyRow = {
      id: r.id, member_id: r.member_id, pay_cycle: r.pay_cycle, date: r.d, product_name: r.product_name,
      issue_date: r.issue_date, ng_cut: ngCut, ng_rope: ngRope, ng_note: r.ng_note || null, ng_cut_allowed: 0, legacy, legacy_excess: 0,
      strike: null, cut_rate: 0, rope_rate: 0, amount: 0,
    };
    if (legacy) {
      // เหมือน SQL เดิมเป๊ะ: MAX(0, ng_cut − ROUND(tol/100 × (good + ng_cut))) — ถ้า tol เป็น NULL ใน SQL ได้ 0
      if (r.tol !== null && r.tol !== undefined) {
        const allowed = Math.round((Number(r.tol) / 100) * ((Number(r.good_qty) || 0) + ngCut));
        row.legacy_excess = Math.max(0, ngCut - allowed);
      }
      row.amount = row.legacy_excess * pol.legacyRate;
    } else {
      // หัก NG ตัดโดนสายไฟส่วนที่อยู่ในเกณฑ์ของใบเบิกนี้ก่อน — ที่เหลือเท่านั้นที่ปรับและนับครั้ง
      if (!allowLeft.has(r.issue_id)) allowLeft.set(r.issue_id, cutAllowanceOf(pol, r.issue_qty));
      const left = allowLeft.get(r.issue_id)!;
      const allowed = Math.min(left, ngCut);
      allowLeft.set(r.issue_id, left - allowed);
      row.ng_cut_allowed = allowed;
      const cutPen = ngCut - allowed;
      if (cutPen > 0 || ngRope > 0) {
        if (!strikeOf.has(r.issue_date)) strikeOf.set(r.issue_date, strikeOf.size + 1);
        row.strike = strikeOf.get(r.issue_date)!;
        const t = tierRates(pol, row.strike);
        row.cut_rate = t.cut; row.rope_rate = t.rope;
        row.amount = cutPen * t.cut + ngRope * t.rope;
      }
    }
    out.push(row);
  }
  return out.filter(r => (!filter.cycle || r.pay_cycle === filter.cycle) && (!filter.memberId || r.member_id === filter.memberId));
}

/** รวมค่าปรับตามคีย์ที่ต้องการ เช่น สมาชิก (ต่อรอบเดียว) หรือ สมาชิก|รอบ */
export function sumPenalties(rows: PenaltyRow[], keyOf: (r: PenaltyRow) => string | number): Map<string | number, number> {
  const m = new Map<string | number, number>();
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) || 0) + r.amount);
  return m;
}

// label = 1 ครั้ง 1 บรรทัด (ใบเสร็จ/หน้าเว็บ) · title/detail = ส่วนหัว/ส่วนรายละเอียดของ label
export type DeductionLine = { label: string; amount: number; note?: string; strike?: number; issue_date?: string; title?: string; detail?: string };

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const thDay = (d: string) => { const [, mo, da] = String(d).split('-'); return `${Number(da)} ${TH_MONTH[Number(mo) - 1] || ''}`; };
const fmtN = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export type StrikeSummary = {
  strike: number; issue_date: string; ng_cut: number; ng_rope: number; cut_rate: number; rope_rate: number; amount: number;
  cut_items: Record<string, number>; rope_items: Record<string, number>;   // รุ่น -> จำนวนเส้น (เฉพาะส่วนที่ปรับ)
  cut_allowed: number;   // NG ตัดโดนสายไฟที่อยู่ในเกณฑ์ (ไม่ปรับ) ของครั้งนี้
  notes: string[];       // รายละเอียด NG ที่กรอกตอนรับคืน (ไม่ซ้ำ)
};

/** ชื่อรุ่นแบบเดียวกับหัวคอลัมน์ในใบเสร็จ: เอาชื่อในวงเล็บ ตัดคำ ป้าย/เส้น/สาย และช่องว่าง + เลขรหัส
    เช่น "MA020-676_A (ป้ายขาวยาว)" -> "ขาวยาว 676" */
export function modelLabel(name: string): string {
  const inner = /\(([^)]+)\)/.exec(name || '');
  const short = (inner ? inner[1] : (name || '-')).replace(/ป้าย|เส้น|สาย/g, '').replace(/\s+/g, '').trim();
  const prefix = String(name || '').split(' (')[0].trim();
  const code = (/-(\d+)/.exec(prefix) || /(\d+)/.exec(prefix) || [])[1] || '';
  return code ? `${short} ${code}`.trim() : short;
}

/** รวมรายการตาม "ครั้ง" (วันที่เบิก) — ใช้ทั้งบรรทัดใบเสร็จและหน้าต่างเตือน */
export function strikeSummaries(rows: PenaltyRow[]): StrikeSummary[] {
  const m = new Map<number, StrikeSummary>();
  for (const r of rows) {
    if (r.strike === null) continue;
    const s = m.get(r.strike) || { strike: r.strike, issue_date: r.issue_date, ng_cut: 0, ng_rope: 0, cut_rate: r.cut_rate, rope_rate: r.rope_rate, amount: 0, cut_items: {}, rope_items: {}, cut_allowed: 0, notes: [] };
    const cutPen = r.ng_cut - (r.ng_cut_allowed || 0);
    s.ng_cut += cutPen; s.ng_rope += r.ng_rope; s.amount += r.amount; s.cut_allowed += r.ng_cut_allowed || 0;
    const ml = modelLabel(r.product_name);
    if (cutPen > 0) s.cut_items[ml] = (s.cut_items[ml] || 0) + cutPen;
    if (r.ng_rope > 0) s.rope_items[ml] = (s.rope_items[ml] || 0) + r.ng_rope;
    const note = String(r.ng_note || '').trim();
    if (note && !s.notes.includes(note)) s.notes.push(note);
    m.set(r.strike, s);
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
}

/** ข้อความรายละเอียดของครั้งหนึ่ง ระบุรุ่น+จำนวนเส้น เช่น
    "ตัดโดนสายไฟ ขาวยาว 676 1 เส้น, ขาวสั้น 633 2 เส้น (5฿/เส้น) + ดึงเชือก ยาวชมพู 674 3 เส้น (3฿/เส้น)" */
export function strikeDetail(s: StrikeSummary): string {
  const part = (label: string, items: Record<string, number>, rate: number) => {
    const list = Object.entries(items).map(([m, q]) => `${m} ${fmtN(q)} เส้น`).join(', ');
    return list ? `${label} ${list}${rate > 0 ? ` (${fmtN(rate)}฿/เส้น)` : ''}` : '';
  };
  const main = [part('NG สมาชิก', s.cut_items, s.cut_rate), part('ดึงเชือก', s.rope_items, s.rope_rate)].filter(Boolean).join(' + ');
  const withAllow = s.cut_allowed > 0 ? `${main} · ไม่รวมที่อยู่ในเกณฑ์ ${fmtN(s.cut_allowed)} เส้น` : main;
  return s.notes.length ? `${withAllow} · ${s.notes.join(', ')}` : withAllow;
}

/** บรรทัดหัก/เตือนสำหรับใบเสร็จ/หน้าสรุปค่าแรง ของสมาชิกหนึ่งคนในรอบเดียว */
export function deductionLines(rows: PenaltyRow[], pol: WagePolicy): DeductionLine[] {
  const lines: DeductionLine[] = [];
  const excess = rows.filter(r => r.legacy).reduce((s, r) => s + r.legacy_excess, 0);
  if (excess > 0 && pol.legacyRate > 0) {
    lines.push({ label: `หัก NG เกินเกณฑ์ (${fmtN(excess)} เส้น × ${fmtN(pol.legacyRate)} บาท)`, amount: excess * pol.legacyRate });
  }
  for (const s of strikeSummaries(rows)) {
    const title = `NG ครั้งที่ ${s.strike} · งานเบิก ${thDay(s.issue_date)}`;
    const suffix = s.strike === 1 ? ' — ตักเตือน' : s.amount <= 0 ? ' — ยังไม่ได้ตั้งอัตราค่าปรับ' : '';
    const detail = strikeDetail(s) + suffix;
    lines.push({ label: `${title} · ${detail}`, title, detail, amount: s.amount > 0 && s.strike > 1 ? s.amount : 0,
      note: s.strike === 1 || s.amount <= 0 ? 'warn' : undefined, strike: s.strike, issue_date: s.issue_date });
  }
  return lines;
}
