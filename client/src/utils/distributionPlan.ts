/* ── วางแผนแจกงานให้สมาชิก (คำนวณฝั่งหน้าเว็บ — ไม่บันทึกอะไรจนกว่าจะกดสร้างใบเบิก) ──────────────────

   หน่วยที่ใช้: "ชุด" = จำนวนเส้น ÷ จำนวนรุ่นในโครงการ (เหมือนหน้าความเร็วสมาชิก) เช่น ป้ายขาว 1 ชุด = ยาว 1 + สั้น 1

   ขั้นที่ 1 — แต่ละคนได้กี่ชุด
     • สมาชิกทั่วไป น้ำหนัก 1 · แอดมินทั่วไป น้ำหนัก adminWeight (มากกว่าคนทั่วไป น้อยกว่าคนยกงาน)
     • คนยกงาน = น้ำหนัก lifterWeight แล้วบีบให้อยู่ในช่วง lifterMin–lifterMax ชุด (งานเยอะได้ใกล้ max งานน้อยได้ใกล้ min)
       ปรับเองรายคนได้ (lifterOverride) · ถ้างานรวมน้อยจนคนยกงานกินเกิน 80% ของงานทั้งหมด → แบ่งตามน้ำหนักล้วน
   ขั้นที่ 2 — แยกกลุ่มชมพู (โครงการห้ามซ้ำกัน เช่น 092 กับ 109): คนที่ได้ 092 จะไม่ได้ 109
     • ขนาดกลุ่มตามสัดส่วนงานของสองโครงการ · คนที่เคยรับโครงการไหนล่าสุดอยู่กลุ่มเดิมก่อน (ต่อเนื่อง ชำนาญ)
     • สลับกลุ่มเองได้ (groupOverride)
   ขั้นที่ 3 — สัดส่วนงานของแต่ละกลุ่ม: งานที่ใช้ร่วมกัน (ป้ายขาว, 3 สาย, …) แบ่งตามขนาดกลุ่ม
     แล้วเกลี่ยงานค่าแรงต่ำสุด (3 สาย) กับงานค่าแรงสูงสุดระหว่างสองกลุ่ม ให้ "ค่าแรงต่อชุด" ของทุกกลุ่มเท่ากัน
     → ทุกคนได้ 3 สายติดไปด้วย และค่าแรงต่อชุดใกล้กันทุกคน (ไม่มีใครได้แต่งานหนักค่าแรงน้อย)
   ขั้นที่ 4 — ในกลุ่มเดียวกัน ทุกคนได้สัดส่วนงานเหมือนกัน ตามจำนวนชุดของตัวเอง
   ขั้นที่ 5 — ปัดเป็นจำนวนเต็ม ๆ ทีละ step (เช่น 50 → 100, 150, 250 …) ด้วยวิธีเศษมากได้ก่อน ยอดรวมตรงกับยอดรับเป๊ะ
     • งาน 3 สาย: ถ้าเศษเท่ากัน คนที่รับ 3 สายน้อยใน 30 วันที่ผ่านมาได้ก่อน (หมุนเวียนให้เป็นธรรม)
     • เศษที่ไม่ครบ step (เช่น 30 เส้น) ไปรวมกับคนที่ได้รุ่นนั้นมากที่สุด */

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
    const goalA = T * KA / (KA + KB);
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

  // ── ขั้นที่ 3: สัดส่วนงานของแต่ละกลุ่ม (ชุดของแต่ละโครงการ)
  const groupsList: ('A' | 'B' | null)[] = twoGroups ? ['A', 'B'] : [null];
  const cap = (g: 'A' | 'B' | null) => members.filter(m => group[m.id] === g).reduce((s, m) => s + target[m.id], 0);
  const share = new Map<string, Map<string, number>>();   // group → project → ชุด
  for (const g of groupsList) share.set(String(g), new Map());
  const shared = [...proj.keys()].filter(k => !(twoGroups && (k === xa || k === xb)));
  if (twoGroups) {
    share.get('A')!.set(xa, proj.get(xa)!.S);
    share.get('B')!.set(xb, proj.get(xb)!.S);
    const KA = proj.get(xa)!.S, KB = proj.get(xb)!.S;
    const room = { A: Math.max(0, cap('A') - KA), B: Math.max(0, cap('B') - KB) };
    const roomAll = room.A + room.B || 1;
    for (const k of shared) {
      share.get('A')!.set(k, proj.get(k)!.S * room.A / roomAll);
      share.get('B')!.set(k, proj.get(k)!.S * room.B / roomAll);
    }
    // เกลี่ยค่าแรงต่อชุด: แลกงานค่าแรงต่ำสุด (L) กับสูงสุด (H) ระหว่างกลุ่ม
    const byW = [...shared].sort((a, b) => wps(a) - wps(b));
    const Lk = byW[0], Hk = byW[byW.length - 1];
    if (Lk && Hk && Lk !== Hk && wps(Hk) - wps(Lk) > 1e-9) {
      const A = share.get('A')!;
      const CA = [...A.values()].reduce((s, v) => s + v, 0);
      const R = A.get(Lk)! + A.get(Hk)!;
      const fixedWage = [...A.entries()].filter(([k]) => k !== Lk && k !== Hk).reduce((s, [k, v]) => s + v * wps(k), 0);
      let HA = (omega * CA - fixedWage - R * wps(Lk)) / (wps(Hk) - wps(Lk));
      HA = Math.min(Math.min(proj.get(Hk)!.S, R), Math.max(Math.max(0, R - proj.get(Lk)!.S), HA));
      A.set(Hk, HA); A.set(Lk, R - HA);
      share.get('B')!.set(Hk, proj.get(Hk)!.S - HA);
      share.get('B')!.set(Lk, proj.get(Lk)!.S - (R - HA));
    }
  } else for (const k of proj.keys()) share.get('null')!.set(k, proj.get(k)!.S);

  // ── ขั้นที่ 4: ค่าที่ควรได้ (ยังไม่ปัด) ต่อคนต่อรุ่น
  const ideal: Record<number, Record<number, number>> = {};
  for (const g of groupsList) {
    const mem = members.filter(m => group[m.id] === g);
    const C = mem.reduce((s, m) => s + target[m.id], 0) || 1;
    for (const [k, S] of share.get(String(g))!) {
      const e = proj.get(k)!;
      for (const p of e.products) {
        const gq = inp.qty[p.id] * (e.S > 0 ? S / e.S : 0);
        for (const m of mem) (ideal[m.id] ||= {})[p.id] = (ideal[m.id][p.id] || 0) + gq * target[m.id] / C;
      }
    }
  }

  // ── ขั้นที่ 5: ปัดทีละ step (ยอดรวมต่อรุ่น = ยอดรับเป๊ะ)
  // • รุ่นในโครงการเดียวกันที่ยอดเท่ากัน (ยาว/สั้น) ปัดพร้อมกันเป็น "ชุด" → แต่ละคนได้ยาว = สั้น เสมอ
  // • ทำทีละรายการ (ค่าแรงรวมมากก่อน) และจำว่าใครได้ขาด/เกินไปจากรายการก่อนหน้า (เป็นบาท)
  //   หน่วยที่เหลือจากการปัดลงให้คนที่ "ขาด" มากที่สุดก่อน → คนเป้าเท่ากันได้ค่าแรงรวมใกล้กัน
  // • งาน 3 สาย: ถ้าขาดเท่า ๆ กัน คนที่รับ 3 สายน้อยใน 30 วันได้ก่อน (หมุนเวียน)
  const step = Math.max(1, st.step || 1);
  const alloc: Record<number, Record<number, number>> = {};
  for (const m of members) alloc[m.id] = {};
  const owe = new Map<number, number>(members.map(m => [m.id, 0]));   // บาทที่ควรได้ − ที่ได้จริง (สะสม)
  type Item = { products: PlanProduct[]; Q: number; wage: number; heavy: boolean };
  const items: Item[] = [];
  for (const [k, e] of proj) {
    const qs = new Set(e.products.map(p => inp.qty[p.id]));
    if (qs.size === 1 && e.products.length > 1) items.push({ products: e.products, Q: inp.qty[e.products[0].id], wage: e.products.reduce((t, p) => t + (p.wage || 0), 0), heavy: k === st.heavy });
    else for (const p of e.products) items.push({ products: [p], Q: inp.qty[p.id], wage: p.wage || 0, heavy: k === st.heavy });
  }
  items.sort((x, y) => y.Q * y.wage - x.Q * x.wage);
  const isLifter = (id: number) => (members.find(x => x.id === id)?.admin_role === 'lifter' ? 1 : 0);
  for (const it of items) {
    const p0 = it.products[0];
    const units = Math.floor(it.Q / step);
    const odd = it.Q - units * step;
    const cand = members.map(m => ({ m, x: (ideal[m.id]?.[p0.id] || 0) / step })).filter(c => c.x > 1e-9);
    if (!cand.length) continue;
    const got = new Map(cand.map(c => [c.m.id, Math.floor(c.x)]));
    let left = units - [...got.values()].reduce((t, v) => t + v, 0);
    const unitWage = step * it.wage;
    // ขาดไปเท่าไร ถ้าได้แค่ส่วนปัดลงของรายการนี้
    const need = (id: number, x: number) => (owe.get(id) || 0) + (x - got.get(id)!) * unitWage;
    while (left > 0) {
      const pick = [...cand].sort((a, b) => {
        const na = need(a.m.id, a.x), nb = need(b.m.id, b.x);
        if (Math.abs(na - nb) > 1e-6) return nb - na;
        if (it.heavy) { const ha = inp.heavyShare[a.m.id] || 0, hb = inp.heavyShare[b.m.id] || 0; if (Math.abs(ha - hb) > 1e-6) return ha - hb; }
        return target[b.m.id] - target[a.m.id] || a.m.id - b.m.id;
      })[0];
      got.set(pick.m.id, got.get(pick.m.id)! + 1); left--;
    }
    while (left < 0) {   // กันกรณีปัดลงแล้วยังเกิน (ไม่น่าเกิด)
      const big = [...got.entries()].sort((x, y) => y[1] - x[1])[0]; got.set(big[0], big[1] - 1); left++;
    }
    for (const c of cand) owe.set(c.m.id, (owe.get(c.m.id) || 0) + (c.x - got.get(c.m.id)!) * unitWage);
    for (const p of it.products) for (const [id, u] of got) if (u > 0) alloc[id][p.id] = u * step;
    if (odd > 0) {   // เศษไม่ครบ step → คนที่ได้รุ่นนี้มากที่สุด (เท่ากันให้คนยกงาน)
      const top = [...got.entries()].sort((x, y) => y[1] - x[1] || isLifter(y[0]) - isLifter(x[0]))[0];
      if (top) for (const p of it.products) alloc[top[0]][p.id] = (alloc[top[0]][p.id] || 0) + odd;
    }
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
