/* ── วางแผนแจกงานให้สมาชิก (คำนวณฝั่งหน้าเว็บ — ไม่บันทึกอะไรจนกว่าจะกดสร้างใบเบิก) ──────────────────

   หน่วยที่ใช้: "ชุด" = จำนวนเส้น ÷ จำนวนรุ่นในโครงการ (เหมือนหน้าความเร็วสมาชิก) เช่น ป้ายขาว 1 ชุด = ยาว 1 + สั้น 1

   ขั้นที่ 1 — แต่ละคนได้กี่ชุด
     • สมาชิกทั่วไป น้ำหนัก 1 · แอดมินทั่วไป น้ำหนัก adminWeight (มากกว่าคนทั่วไป น้อยกว่าคนยกงาน)
     • คนยกงาน = น้ำหนัก lifterWeight แล้วบีบให้อยู่ในช่วง lifterMin–lifterMax ชุด (งานเยอะได้ใกล้ max งานน้อยได้ใกล้ min)
       ปรับเองรายคนได้ (lifterOverride) · ถ้างานรวมน้อยจนคนยกงานกินเกิน 80% ของงานทั้งหมด → แบ่งตามน้ำหนักล้วน
   ขั้นที่ 2 — แยกกลุ่มชมพู (โครงการห้ามซ้ำกัน เช่น 092 กับ 109): คนที่ได้ 092 จะไม่ได้ 109
     • ขนาดกลุ่มตามสัดส่วนงานของสองโครงการ · คนที่เคยรับโครงการไหนล่าสุดอยู่กลุ่มเดิมก่อน (ต่อเนื่อง ชำนาญ)
     • สลับกลุ่มเองได้ (groupOverride)
   ขั้นที่ 3 — สมาชิกทั่วไป (ไม่ได้รับแต่งตั้ง) ที่ได้งานประเภทเดียวกัน ได้จำนวน "เท่ากันทุกคน"
     • งานที่ใช้ร่วมกัน (ป้ายขาว, 3 สาย, …) ทุกคนได้เท่ากัน → 3 สายกระจายให้ทุกคนเท่า ๆ กัน
     • งานชมพู: คนในกลุ่มเดียวกันได้เท่ากัน · ขนาดกลุ่มตั้งตามค่าแรงรวมของงานชมพูแต่ละแบบ ค่าแรงสองกลุ่มจึงใกล้กัน
     • คนที่ได้รับแต่งตั้งได้ส่วนแบ่งมากกว่า: แอดมินทั่วไป = adminWeight เท่าของคนทั่วไป · คนยกงาน = ปรับให้รวมได้ตามเป้าชุด
   ขั้นที่ 4 — ปัดลงเป็นจำนวนเต็มทีละ step (เช่น 50 → 100, 150, 250 …) — คนทั่วไปยังได้เท่ากันทุกคน
     เศษที่แบ่งให้เท่ากันไม่ได้ "คงเหลือไว้" ไม่แจก (หน้าเว็บมีปุ่มให้แจกเศษให้คนที่ได้รับแต่งตั้งได้ถ้าต้องการ) */

export type Role = 'lifter' | 'admin' | null;
export type PlanProduct = { id: number; code: string; name: string; project: string | null; wage: number; color?: string | null; unit?: string };
export type PlanMember = { id: number; code: string; name: string; nickname?: string | null; admin_role: Role };
export type PlanSettings = { lifter_min: number; lifter_max: number; lifter_weight: number; admin_weight: number; step: number; exclusive: string[]; heavy: string };
export type PlanInput = {
  products: PlanProduct[];                 // สินค้าทั้งหมด (ใช้หาขนาดชุดของโครงการ)
  qty: Record<number, number>;             // ยอดที่จะแจกต่อรุ่น
  members: PlanMember[];                   // คนที่จะรับงานรอบนี้
  pinkPref: Record<number, string>;        // โครงการชมพูที่แต่ละคนรับล่าสุด
  heavyShare: Record<number, number>;      // สัดส่วน 3 สายใน 30 วัน (0–1) ของแต่ละคน
  groupOverride: Record<number, 'A' | 'B'>;
  lifterOverride: Record<number, number>;  // ชุด/วัน ที่ตั้งเองสำหรับคนยกงาน
  settings: PlanSettings;
};
export type PlanResult = {
  alloc: Record<number, Record<number, number>>;   // member → product → เส้น
  group: Record<number, 'A' | 'B' | null>;
  targetSets: Record<number, number>;
  groups: { A: string; B: string } | null;          // โครงการของกลุ่ม A / B
  avgWagePerSet: number;
  notes: string[];
};

export const projKey = (p: PlanProduct) => p.project || `#${p.id}`;

export function setSizes(products: PlanProduct[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) m.set(projKey(p), (m.get(projKey(p)) || 0) + 1);
  return m;
}

export function weightOf(role: Role, s: PlanSettings) {
  return role === 'lifter' ? s.lifter_weight : role === 'admin' ? s.admin_weight : 1;
}

export function computePlan(inp: PlanInput): PlanResult {
  const { settings: st, members } = inp;
  const notes: string[] = [];
  const size = setSizes(inp.products);
  const live = inp.products.filter(p => (inp.qty[p.id] || 0) > 0);
  const empty: PlanResult = { alloc: {}, group: {}, targetSets: {}, groups: null, avgWagePerSet: 0, notes };
  if (!live.length || !members.length) return empty;

  // ── โครงการ: ชุด (S) และค่าแรงรวม (W)
  const proj = new Map<string, { S: number; W: number; products: PlanProduct[] }>();
  for (const p of live) {
    const k = projKey(p);
    const e = proj.get(k) || { S: 0, W: 0, products: [] };
    e.S += inp.qty[p.id] / (size.get(k) || 1);
    e.W += inp.qty[p.id] * (p.wage || 0);
    e.products.push(p);
    proj.set(k, e);
  }
  const T = [...proj.values()].reduce((s, e) => s + e.S, 0);
  const Wtot = [...proj.values()].reduce((s, e) => s + e.W, 0);
  const omega = T > 0 ? Wtot / T : 0;
  const wps = (k: string) => { const e = proj.get(k)!; return e.S > 0 ? e.W / e.S : 0; };

  // ── ขั้นที่ 1: ชุดของแต่ละคน
  const lifters = members.filter(m => m.admin_role === 'lifter');
  const others = members.filter(m => m.admin_role !== 'lifter');
  const wOthers = others.reduce((s, m) => s + weightOf(m.admin_role, st), 0);
  const target: Record<number, number> = {};
  const proportional = () => {
    const wAll = members.reduce((s, m) => s + weightOf(m.admin_role, st), 0);
    for (const m of members) target[m.id] = T * weightOf(m.admin_role, st) / wAll;
  };
  if (!lifters.length || !others.length) proportional();
  else {
    let u = T / (wOthers + lifters.length * st.lifter_weight);
    let L: Record<number, number> = {};
    for (let it = 0; it < 6; it++) {
      L = {};
      for (const m of lifters) L[m.id] = inp.lifterOverride[m.id] ?? Math.min(st.lifter_max, Math.max(st.lifter_min, st.lifter_weight * u));
      const sumL = Object.values(L).reduce((a, b) => a + b, 0);
      u = Math.max(0, (T - sumL) / wOthers);
    }
    const sumL = Object.values(L).reduce((a, b) => a + b, 0);
    if (sumL > 0.8 * T) {
      notes.push(`งานรวมมีแค่ ${Math.round(T).toLocaleString()} ชุด — ไม่พอให้คนยกงานได้ขั้นต่ำ ${st.lifter_min} ชุด จึงแบ่งตามน้ำหนักแทน`);
      proportional();
    } else {
      for (const m of lifters) target[m.id] = L[m.id];
      for (const m of others) target[m.id] = u * weightOf(m.admin_role, st);
    }
  }

  // ── ขั้นที่ 2: กลุ่มชมพู
  const [xa, xb] = st.exclusive;
  const twoGroups = !!(xa && xb && proj.has(xa) && proj.has(xb));
  const group: Record<number, 'A' | 'B' | null> = {};
  if (twoGroups) {
    const KA = proj.get(xa)!.S, KB = proj.get(xb)!.S;
    const WA = proj.get(xa)!.W, WB = proj.get(xb)!.W;
    const goalA = WA + WB > 0 ? T * WA / (WA + WB) : T * KA / (KA + KB);   // แบ่งคนตามค่าแรงรวมของงานชมพูแต่ละแบบ
    const fixed = new Set(Object.keys(inp.groupOverride).map(Number));
    const prefOf = (id: number): 'A' | 'B' | null => inp.pinkPref[id] === xa ? 'A' : inp.pinkPref[id] === xb ? 'B' : null;
    let capA = 0;
    const later: PlanMember[] = [];
    for (const m of members) {
      const g = inp.groupOverride[m.id] ?? prefOf(m.id);
      if (g) { group[m.id] = g; if (g === 'A') capA += target[m.id]; } else later.push(m);
    }
    const capOf = (g: 'A' | 'B') => members.filter(m => group[m.id] === g).reduce((s, m) => s + target[m.id], 0);
    for (const m of later.sort((a, b) => target[b.id] - target[a.id])) {
      const needA = goalA - capA, needB = (T - goalA) - capOf('B');
      group[m.id] = needA >= needB ? 'A' : 'B';
      if (group[m.id] === 'A') capA += target[m.id];
    }
    // เกลี่ยขนาดกลุ่มให้ใกล้เป้า — ย้ายคนที่ไม่ได้ล็อกไว้ เลือกคนที่ไม่มีประวัติชมพู/เคยรับอีกกลุ่มก่อน
    for (let guard = 0; guard < 60; guard++) {
      const diff = capOf('A') - goalA;
      const from: 'A' | 'B' = diff > 0 ? 'A' : 'B';
      const movable = members.filter(m => group[m.id] === from && !fixed.has(m.id) && members.filter(x => group[x.id] === from).length > 1);
      if (!movable.length) break;
      const gain = (m: PlanMember) => Math.abs(Math.abs(diff) - target[m.id]) - Math.abs(diff);   // ติดลบ = ย้ายแล้วใกล้เป้าขึ้น
      const penalty = (m: PlanMember) => (prefOf(m.id) === from ? 0.25 * target[m.id] : 0);         // ย้ายคนที่ชำนาญกลุ่มเดิม = เสียน้อยลงหน่อย
      const best = movable.map(m => ({ m, v: gain(m) + penalty(m) })).sort((a, b) => a.v - b.v)[0];
      if (!best || best.v >= -1e-6) break;
      group[best.m.id] = from === 'A' ? 'B' : 'A';
    }
    for (const g of ['A', 'B'] as const) {
      if (!members.some(m => group[m.id] === g)) {
        const other = g === 'A' ? 'B' : 'A';
        const pick = members.filter(m => group[m.id] === other).sort((a, b) => target[a.id] - target[b.id])[0];
        if (pick) { group[pick.id] = g; notes.push('สมาชิกน้อยเกินไปสำหรับแยกกลุ่มชมพู — ย้ายให้กลุ่มละอย่างน้อย 1 คน'); }
      }
    }
  } else for (const m of members) group[m.id] = null;

  // ── ขั้นที่ 3: ส่วนแบ่งต่อรุ่น — คนทั่วไป factor 1 (เท่ากัน) · แอดมิน factor = adminWeight · คนยกงานปรับ factor ให้ได้ตามเป้าชุด
  const eligible = (p: PlanProduct, m: PlanMember) => {
    if (!twoGroups) return true;
    const k = projKey(p);
    return k === xa ? group[m.id] === 'A' : k === xb ? group[m.id] === 'B' : true;
  };
  const normalSets = others.filter(m => !m.admin_role).map(m => target[m.id])[0] || (T / Math.max(1, members.length));
  const f = new Map<number, number>(members.map(m => [m.id,
    m.admin_role === 'admin' ? st.admin_weight : m.admin_role === 'lifter' ? Math.max(0.1, target[m.id] / normalSets) : 1]));
  const ideal: Record<number, Record<number, number>> = {};
  const fill = () => {
    for (const m of members) ideal[m.id] = {};
    for (const p of live) {
      const E = members.filter(m => eligible(p, m));
      const F = E.reduce((t, m) => t + f.get(m.id)!, 0) || 1;
      for (const m of E) ideal[m.id][p.id] = inp.qty[p.id] * f.get(m.id)! / F;
    }
  };
  const setsOf = (id: number) => live.reduce((t, p) => t + (ideal[id]?.[p.id] || 0) / (size.get(projKey(p)) || 1), 0);
  fill();
  if (members.some(m => !m.admin_role) && lifters.length) {
    for (let it = 0; it < 8; it++) {   // ปรับส่วนแบ่งคนยกงานให้รวมแล้วได้ตามเป้า (750–1,000 ชุด หรือที่ตั้งเอง)
      for (const m of lifters) { const got = setsOf(m.id); if (got > 0) f.set(m.id, Math.max(0.05, f.get(m.id)! * target[m.id] / got)); }
      fill();
    }
  }

  // ── ขั้นที่ 4: ปัดลงทีละ step — คนทั่วไปที่ได้รุ่นเดียวกันได้เท่ากันทุกคน · เศษคงเหลือไว้ไม่แจก
  const step = Math.max(1, st.step || 1);
  const alloc: Record<number, Record<number, number>> = {};
  for (const m of members) alloc[m.id] = {};
  for (const p of live) {
    const E = members.filter(m => eligible(p, m));
    const appointed = E.filter(m => m.admin_role);
    const normals = E.filter(m => !m.admin_role);
    const Q = inp.qty[p.id];
    const fA = appointed.reduce((t, m) => t + f.get(m.id)!, 0);
    // คนที่ได้รับแต่งตั้ง: ได้อย่างน้อยเท่าคนทั่วไป (base) + ส่วนเพิ่มตามสัดส่วน · ไม่เกินส่วนแบ่งของตัวเอง (ปัดขึ้น) — เศษที่เหลือคงไว้
    const putAppointed = (R: number, base: number) => {
      let used = 0;
      const extra = Math.max(0, R - base * appointed.length);
      for (const m of appointed) {
        const cap = Math.max(base / step, Math.ceil((ideal[m.id]?.[p.id] || 0) / step - 1e-9));
        const add = fA > 0 ? Math.floor(extra * f.get(m.id)! / fA / step + 1e-9) : 0;
        const q = Math.min(base / step + add, cap) * step;
        if (q > 0) { alloc[m.id][p.id] = q; used += q; } else delete alloc[m.id][p.id];
      }
      return used;
    };
    if (!normals.length) { putAppointed(Q, 0); continue; }
    // คนทั่วไป: ได้เท่ากันทุกคน = ส่วนแบ่งที่ควรได้ ปัดเป็นจำนวนเต็มทีละ step ที่ใกล้ที่สุด
    // โดยต้องเหลือพอให้คนที่ได้รับแต่งตั้งได้อย่างน้อยเท่ากัน (ไม่งั้นลดลงทีละ step)
    const n = normals.length, A = appointed.length;
    const share = ideal[normals[0].id]?.[p.id] || 0;
    let qn = Math.min(Math.floor(Q / (n + A) / step + 1e-9), Math.round(share / step)) * step;
    let usedA = putAppointed(Q - n * qn, qn);
    // ถ้ายังเหลือพอให้ทุกคน (รวมคนที่ได้รับแต่งตั้ง) เพิ่มได้อีกคนละ step → เพิ่มให้คนทั่วไปเท่ากันทุกคน
    while (Q - n * qn - usedA >= n * step && Q - n * (qn + step) >= A * (qn + step)) { qn += step; usedA = putAppointed(Q - n * qn, qn); }
    if (qn > 0) for (const m of normals) alloc[m.id][p.id] = qn;
  }

  return { alloc, group, targetSets: target, groups: twoGroups ? { A: xa, B: xb } : null, avgWagePerSet: omega, notes };
}

/* ── สรุปต่อคน: ชุด / ค่าแรง / ค่าแรงต่อชุด / ชุด 3 สาย / ผิดกติกาชมพูไหม */
export function memberStats(alloc: Record<number, number>, products: PlanProduct[], st: PlanSettings) {
  const size = setSizes(products);
  let sets = 0, wage = 0, heavy = 0;
  const projs = new Set<string>();
  for (const p of products) {
    const q = alloc[p.id] || 0;
    if (!q) continue;
    const k = projKey(p);
    const s = q / (size.get(k) || 1);
    sets += s; wage += q * (p.wage || 0); projs.add(k);
    if (k === st.heavy) heavy += s;
  }
  const [xa, xb] = st.exclusive;
  return { sets, wage, heavy, wps: sets > 0 ? wage / sets : 0, conflict: !!(xa && xb && projs.has(xa) && projs.has(xb)) };
}
