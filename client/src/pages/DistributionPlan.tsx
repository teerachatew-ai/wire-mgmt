import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Share2, Users, Package, RotateCcw, Settings2, X, Plus, Lock, AlertTriangle, CheckCircle2, Loader2, Scale, Search, ClipboardCheck, Info,
} from 'lucide-react';
import { reportApi, receiveApi, issueApi } from '../api';
import { computePlan, memberStats, projKey, setSizes, weightOf, PlanSettings } from '../utils/distributionPlan';
import { AdminRolePicker } from '../components/AdminRole';
import ExportExcelButton from '../components/ExportExcelButton';

/* ── วางแผนแจกงานให้สมาชิก ─────────────────────────────────────────────────────────────
   ① กรอกยอดงานที่จะแจกต่อรุ่น  ② เลือกคนรับงาน (ค่าเริ่มต้น = คนที่มารับงานวันเบิกล่าสุด)
   ③ ระบบเสนอแผน (utils/distributionPlan.ts) — แก้ตัวเลขในตารางเองได้ แล้วกดสร้างใบเบิกตามแผน
   ร่างทั้งหมดเก็บไว้ในเครื่อง ปิดหน้าแล้วกลับมาทำต่อได้ */

type Draft = {
  qty: Record<number, string>; memberIds: number[]; date: string;
  groupOverride: Record<number, 'A' | 'B'>; lifterOverride: Record<number, number>;
  edits: Record<number, Record<number, number>>;
};
const KEY = 'wire_distribution_plan_draft';
const readDraft = (): Draft | null => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && d.qty ? d : null; } catch { return null; } };
const writeDraft = (d: Draft) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* */ } };
const fmt = (n: number, d = 0) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDay = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${dd} ${TH_M[m - 1]}`; };
const shortName = (n: string) => { const m = String(n).match(/^(.*?)\s*\((.*)\)\s*$/); return m ? [m[1], m[2]] : [n, '']; };

export default function DistributionPlan() {
  const qc = useQueryClient();
  const { data: ctx, isLoading } = useQuery({ queryKey: ['distribution-context'], queryFn: reportApi.distributionContext });
  const { data: lots = [] } = useQuery({ queryKey: ['receive-lots', 'all'], queryFn: () => receiveApi.lots() });

  const draft = useMemo(readDraft, []);
  const [qty, setQty] = useState<Record<number, string>>(draft?.qty || {});
  const [memberIds, setMemberIds] = useState<number[] | null>(draft?.memberIds || null);
  const [date, setDate] = useState(draft?.date || today());
  const [groupOverride, setGroupOverride] = useState<Record<number, 'A' | 'B'>>(draft?.groupOverride || {});
  const [lifterOverride, setLifterOverride] = useState<Record<number, number>>(draft?.lifterOverride || {});
  const [edits, setEdits] = useState<Record<number, Record<number, number>>>(draft?.edits || {});
  const [st, setSt] = useState<PlanSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Record<number, { ok: boolean; msg: string }>>({});

  useEffect(() => { if (ctx && !st) setSt(ctx.settings); }, [ctx, st]);
  // ค่าเริ่มต้นของคนรับงาน = คนที่มารับงานวันเบิกล่าสุด
  useEffect(() => {
    if (ctx && memberIds === null) {
      const active = new Set((ctx.members as any[]).map(m => m.id));
      setMemberIds((ctx.recent_dates?.[0]?.member_ids || []).filter((id: number) => active.has(id)));
    }
  }, [ctx, memberIds]);
  useEffect(() => { if (memberIds) writeDraft({ qty, memberIds, date, groupOverride, lifterOverride, edits }); }, [qty, memberIds, date, groupOverride, lifterOverride, edits]);

  const products: any[] = ctx?.products || [];
  const allMembers: any[] = ctx?.members || [];
  const byId = useMemo(() => new Map(allMembers.map(m => [m.id, m])), [allMembers]);
  const members = useMemo(() => (memberIds || []).map(id => byId.get(id)).filter(Boolean), [memberIds, byId]);
  const numQty = useMemo(() => Object.fromEntries(products.map(p => [p.id, Math.max(0, parseFloat(qty[p.id] || '') || 0)])), [products, qty]);
  const heavyShare = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [id, l] of Object.entries(ctx?.load_30d || {}) as any) out[Number(id)] = l.sets > 0 ? l.heavy / l.sets : 0;
    return out;
  }, [ctx]);
  const projects = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const p of products) { const k = projKey(p); g.set(k, [...(g.get(k) || []), p]); }
    return [...g.entries()];
  }, [products]);
  const size = useMemo(() => setSizes(products), [products]);

  const plan = useMemo(() => (st ? computePlan({
    products, qty: numQty, members, pinkPref: ctx?.pink_pref || {}, heavyShare, groupOverride, lifterOverride, settings: st,
  }) : null), [products, numQty, members, ctx, heavyShare, groupOverride, lifterOverride, st]);

  // แก้อะไรที่กระทบการคำนวณ → ล้างตัวเลขที่แก้เองในตาราง
  const reset = () => setEdits({});
  const cell = (mid: number, pid: number) => edits[mid]?.[pid] ?? plan?.alloc[mid]?.[pid] ?? 0;
  const allocOf = (mid: number) => Object.fromEntries(products.map(p => [p.id, cell(mid, p.id)]));
  const live = products.filter(p => numQty[p.id] > 0);
  const totalOf = (pid: number) => members.reduce((s, m) => s + cell(m.id, pid), 0);
  const editedCount = Object.values(edits).reduce((s, r) => s + Object.keys(r).length, 0);

  // ยอดรอเบิกปัจจุบัน (ล็อตที่ยังเหลือ)
  const waiting = useMemo(() => {
    const w: Record<number, number> = {};
    for (const l of lots as any[]) if ((l.remaining_qty || 0) > 0) w[l.product_id] = (w[l.product_id] || 0) + l.remaining_qty;
    return w;
  }, [lots]);
  const lotFor = (pid: number) => {
    const mine = (lots as any[]).filter(l => l.product_id === pid).sort((a, b) => a.lot_date.localeCompare(b.lot_date));
    const withStock = mine.find(l => l.remaining_qty > 0 && l.lot_date <= date);
    if (withStock) return withStock.lot_date;
    const arrived = mine.filter(l => l.lot_date <= date);
    return arrived.length ? arrived[arrived.length - 1].lot_date : null;
  };

  if (isLoading || !ctx || !st || !plan) return <div className="p-6 text-gray-400"><Loader2 className="animate-spin inline mr-2" size={16} />กำลังโหลด…</div>;

  const stats = Object.fromEntries(members.map(m => [m.id, memberStats(allocOf(m.id), products, st)]));
  const normals = members.filter(m => !m.admin_role).map(m => stats[m.id].wage).filter(w => w > 0);
  const spread = normals.length > 1 ? (Math.max(...normals) - Math.min(...normals)) / (normals.reduce((a, b) => a + b, 0) / normals.length) : 0;
  const heavyLive = live.some(p => projKey(p) === st.heavy);
  const heavyPeople = members.filter(m => stats[m.id].heavy > 0).length;
  const conflicts = members.filter(m => stats[m.id].conflict);
  const remaining = live.map(p => ({ p, r: numQty[p.id] - totalOf(p.id) })).filter(x => Math.abs(x.r) > 0.001);
  const over = remaining.filter(x => x.r < 0);                       // แจกเกินยอด = ผิด
  const leftTotal = remaining.filter(x => x.r > 0).reduce((t, x) => t + x.r, 0);   // เศษที่คงเหลือไว้ (ตั้งใจ ไม่ใช่ข้อผิดพลาด)
  const totalSets = live.reduce((s, p) => s + numQty[p.id] / (size.get(projKey(p)) || 1), 0);
  const totalWage = live.reduce((s, p) => s + numQty[p.id] * (p.wage || 0), 0);
  const groupLabel = (g: 'A' | 'B' | null) => (g && plan.groups ? (g === 'A' ? plan.groups.A : plan.groups.B) : '');
  const candidates = allMembers.filter(m => !(memberIds || []).includes(m.id) && (!search.trim() || `${m.code} ${m.name} ${m.nickname || ''}`.toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 8);

  const setMemberList = (ids: number[]) => { setMemberIds(ids); reset(); setResult({}); };
  const saveSettings = async () => {
    await reportApi.saveSettings({
      plan_lifter_min: st.lifter_min, plan_lifter_max: st.lifter_max, plan_lifter_weight: st.lifter_weight,
      plan_admin_weight: st.admin_weight, plan_round_step: st.step,
    });
    qc.invalidateQueries({ queryKey: ['distribution-context'] });
    setShowSettings(false);
  };

  const createIssues = async () => {
    const todo = members.filter(m => live.some(p => cell(m.id, p.id) > 0) && !result[m.id]?.ok);
    if (!todo.length) return;
    const warn = (remaining.some(x => x.r > 0) ? `\n\nคงเหลือไว้ (ไม่แจกรอบนี้): ${remaining.filter(x => x.r > 0).map(x => `${shortName(x.p.name)[0]} ${fmt(x.r)}`).join(', ')}` : '')
      + (over.length ? `\n⚠ แจกเกินยอด: ${over.map(x => `${shortName(x.p.name)[0]} ${fmt(-x.r)}`).join(', ')}` : '');
    const warn2 = conflicts.length ? `\n⚠ มีคนได้ทั้ง ${st.exclusive.join(' และ ')}: ${conflicts.map(m => m.code).join(', ')}` : '';
    if (!confirm(`สร้างใบเบิกวันที่ ${date.split('-').reverse().join('/')} ให้ ${todo.length} คน ตามแผนนี้?${warn}${warn2}`)) return;
    setSaving(true);
    const res: Record<number, { ok: boolean; msg: string }> = { ...result };
    for (const m of todo) {
      const lines = live.map(p => ({ product_id: p.id, quantity: cell(m.id, p.id), lot_date: lotFor(p.id) })).filter(l => l.quantity > 0);
      try {
        const r = await issueApi.createBatch({ issued_at: date, member_id: m.id, lines });
        const failed = (r.failed || []).length;
        res[m.id] = failed ? { ok: false, msg: `บันทึกไม่ครบ ${failed} รายการ` } : { ok: true, msg: `สร้าง ${r.created.length} ใบ` };
      } catch (e: any) {
        res[m.id] = { ok: false, msg: e?.response?.data?.error || 'บันทึกไม่สำเร็จ' };
      }
      setResult({ ...res });
    }
    for (const k of ['issues', 'stock-flow', 'receive-lots', 'reports', 'dashboard', 'distribution-context']) qc.invalidateQueries({ queryKey: [k] });
    setSaving(false);
  };
  const doneCount = Object.values(result).filter(r => r.ok).length;

  const exportRows = members.map(m => ({
    'รหัส': m.code, 'ชื่อ': m.name, 'ชื่อเล่น': m.nickname || '',
    'ตำแหน่ง': m.admin_role === 'lifter' ? 'ช่วยยกงาน' : m.admin_role === 'admin' ? 'แอดมินทั่วไป' : '',
    'กลุ่มชมพู': groupLabel(plan.group[m.id]),
    ...Object.fromEntries(live.map(p => [p.name, cell(m.id, p.id)])),
    'รวมชุด': Math.round(stats[m.id].sets), 'ค่าแรงประมาณ (บาท)': Math.round(stats[m.id].wage * 100) / 100,
  }));

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2"><Share2 size={22} className="text-sky-600" /> วางแผนแจกงาน
            <span className="rounded-full bg-amber-400 text-amber-950 px-2 py-0.5 text-[11px] font-bold tracking-wide">BETA · ทดลองใช้</span></h1>
          <p className="text-sm text-gray-500 mt-0.5">กรอกยอดงาน → เลือกคนรับงาน → ระบบเสนอแผนที่ค่าแรงสมดุล แก้ได้ทุกช่อง แล้วสร้างใบเบิกได้ในครั้งเดียว</p>
          <p className="text-xs text-amber-700 mt-1">เมนูนี้อยู่ระหว่างทดลองใช้ — ตรวจตัวเลขในแผนก่อนกดสร้างใบเบิกทุกครั้ง ถ้าเจอจุดที่แจกไม่สมเหตุสมผลแจ้งได้เลย</p>
        </div>
        <button type="button" className="btn-secondary btn-sm flex items-center gap-1.5" onClick={() => setShowSettings(true)}><Settings2 size={14} /> ตั้งค่าการแจก</button>
      </div>

      {/* ① ยอดงาน */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">1</span>
          <h2 className="font-semibold text-gray-800 flex items-center gap-1.5"><Package size={16} /> ยอดงานที่จะแจก</h2>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setQty(Object.fromEntries(products.map(p => [p.id, waiting[p.id] ? String(Math.round(waiting[p.id])) : '']))); reset(); }}>ใช้ยอดรอเบิกทั้งหมด</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setQty({}); reset(); }}>ล้าง</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {projects.map(([k, list]) => (
            <div key={k} className={`rounded-xl border p-3 space-y-2 ${k === st.heavy ? 'border-amber-200 bg-amber-50/40' : st.exclusive.includes(k) ? 'border-pink-200 bg-pink-50/30' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                {k}
                {k === st.heavy && <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px]">งานหนัก · กระจายทุกคน</span>}
                {st.exclusive.includes(k) && <span className="rounded-full bg-pink-100 text-pink-800 px-1.5 py-0.5 text-[10px]">ห้ามได้คู่กับ {st.exclusive.find(x => x !== k)}</span>}
              </div>
              {list.map((p: any) => {
                const [a, b] = shortName(p.name);
                return (
                  <label key={p.id} className="flex items-center gap-2">
                    {p.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                    <span className="flex-1 min-w-0 text-sm leading-tight"><span className="text-gray-800">{a}</span>{b && <span className="block text-[11px] text-gray-400">{b} · รอเบิก {fmt(waiting[p.id] || 0)}</span>}</span>
                    <input type="number" inputMode="numeric" min="0" step={st.step} className="input !w-28 text-right tabular-nums" placeholder="0"
                      value={qty[p.id] ?? ''} onChange={e => { setQty(q => ({ ...q, [p.id]: e.target.value })); reset(); }} aria-label={`ยอด ${p.name}`} />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-600">รวม <b className="tabular-nums">{fmt(totalSets)}</b> ชุด · ค่าแรงรวม <b className="tabular-nums">฿{fmt(totalWage, 2)}</b></p>
      </section>

      {/* ② คนรับงาน */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">2</span>
          <h2 className="font-semibold text-gray-800 flex items-center gap-1.5"><Users size={16} /> คนรับงาน <span className="text-gray-400 font-normal">({members.length} คน)</span></h2>
          <select className="input !w-auto ml-auto text-sm" value="" onChange={e => { const d = (ctx.recent_dates as any[]).find(x => x.date === e.target.value); if (d) setMemberList(d.member_ids.filter((id: number) => byId.has(id))); }}>
            <option value="">ดึงรายชื่อจากวันเบิก…</option>
            {(ctx.recent_dates as any[]).map(d => <option key={d.date} value={d.date}>{thDay(d.date)} · {d.count} คน</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {members.map(m => (
            <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-1 py-1 text-sm">
              <span className="font-mono text-[11px] text-gray-400">{m.code}</span>
              <span className="text-gray-800">{m.nickname || m.name}</span>
              <AdminRolePicker member={m} compact />
              <button type="button" aria-label={`เอา ${m.name} ออก`} className="p-1 rounded-full text-gray-300 hover:text-rose-600 hover:bg-rose-50"
                onClick={() => setMemberList((memberIds || []).filter(id => id !== m.id))}><X size={14} /></button>
            </span>
          ))}
          <div className="relative">
            <div className="flex items-center gap-1 rounded-full border border-dashed border-sky-300 px-2.5 py-1">
              <Search size={13} className="text-sky-500" />
              <input className="outline-none text-sm w-36 bg-transparent" placeholder="เพิ่มสมาชิก…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {search.trim() && (
              <div className="absolute z-30 mt-1 w-64 rounded-xl border bg-white shadow-xl p-1">
                {candidates.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">ไม่พบ</p>}
                {candidates.map(m => (
                  <button key={m.id} type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-sky-50 text-sm flex items-center gap-2"
                    onClick={() => { setMemberList([...(memberIds || []), m.id]); setSearch(''); }}>
                    <Plus size={13} className="text-sky-600" /><span className="font-mono text-[11px] text-gray-400">{m.code}</span>{m.name}{m.nickname ? ` (${m.nickname})` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500">น้ำหนักงาน: สมาชิกทั่วไป 1 · แอดมินทั่วไป {st.admin_weight} เท่า · ช่วยยกงาน {fmt(st.lifter_min)}–{fmt(st.lifter_max)} ชุด/วัน — แต่งตั้งตำแหน่งได้ที่ปุ่มมงกุฎ (หรือในเมนูสมาชิก)</p>
      </section>

      {/* ③ แผน */}
      <section className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2 flex-wrap">
          <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">3</span>
          <h2 className="font-semibold text-gray-800 flex items-center gap-1.5"><Scale size={16} /> แผนการแจก</h2>
          {editedCount > 0 && <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">แก้เอง {editedCount} ช่อง</span>}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {editedCount > 0 && <button type="button" className="btn-secondary btn-sm flex items-center gap-1" onClick={reset}><RotateCcw size={13} /> กลับเป็นแผนของระบบ</button>}
            <ExportExcelButton filename={`แผนแจกงาน-${date}`} rows={exportRows} />
          </div>
        </div>

        {/* สรุปความเป็นธรรม */}
        {live.length > 0 && members.length > 0 && (
          <div className="px-4 py-3 grid grid-cols-2 lg:grid-cols-4 gap-2 border-b bg-slate-50/60">
            <Chip ok={over.length === 0} label={over.length ? 'แจกเกินยอด' : 'คงเหลือไว้ (แบ่งเท่ากันไม่ได้)'} value={over.length ? `เกิน ${over.length} รุ่น` : leftTotal > 0 ? `${fmt(leftTotal)} เส้น` : 'แจกครบทุกรุ่น'} />
            <Chip ok={spread <= 0.15} label="ค่าแรงคนทั่วไป ต่างกัน" value={normals.length > 1 ? `${fmt(Math.min(...normals))}–${fmt(Math.max(...normals))} ฿ (${fmt(spread * 100, 1)}%)` : '-'} />
            <Chip ok={!heavyLive || heavyPeople >= Math.ceil(members.length * 0.6)} label={`งานหนัก ${st.heavy}`} value={heavyLive ? `กระจาย ${heavyPeople}/${members.length} คน` : 'ไม่มีรอบนี้'} />
            <Chip ok={conflicts.length === 0} label={`${st.exclusive.join(' / ')} ห้ามซ้ำคน`} value={conflicts.length ? `ซ้ำ ${conflicts.length} คน` : plan.groups ? 'ถูกต้อง' : 'ไม่ต้องแยกรอบนี้'} />
          </div>
        )}
        {plan.notes.map((n, i) => <p key={i} className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b flex items-center gap-1.5"><Info size={13} /> {n}</p>)}

        {live.length === 0 || members.length === 0 ? (
          <p className="p-8 text-center text-gray-400 text-sm">{live.length === 0 ? 'กรอกยอดงานในข้อ 1 ก่อน' : 'เลือกคนรับงานในข้อ 2 ก่อน'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm tabular-nums min-w-full">
              <thead>
                <tr className="text-[11px] text-gray-500 bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium min-w-[220px]" rowSpan={2}>สมาชิก</th>
                  {projects.filter(([, l]) => l.some((p: any) => numQty[p.id] > 0)).map(([k, l]) => (
                    <th key={k} colSpan={l.filter((p: any) => numQty[p.id] > 0).length}
                      className={`px-2 pt-2 pb-0.5 font-semibold border-l ${k === st.heavy ? 'text-amber-700' : st.exclusive.includes(k) ? 'text-pink-700' : ''}`}>{k}</th>
                  ))}
                  <th className="px-2 py-2 font-medium border-l text-right" rowSpan={2}>ชุด</th>
                  <th className="px-2 py-2 font-medium text-right" rowSpan={2}>ค่าแรง ฿</th>
                  <th className="px-3 py-2 font-medium text-right" rowSpan={2} title="ค่าแรงเฉลี่ยต่อชุด — ยิ่งใกล้กันยิ่งเป็นธรรม">฿/ชุด</th>
                </tr>
                <tr className="text-[11px] text-gray-500 bg-gray-50 border-b">
                  {live.map(p => {
                    const [a, b] = shortName(p.name);
                    return <th key={p.id} className="px-2 pb-2 font-normal text-right whitespace-nowrap border-l first:border-l-0" title={p.name}>{b || a}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const s = stats[m.id];
                  const g = plan.group[m.id];
                  const r = result[m.id];
                  return (
                    <tr key={m.id} className={`border-b ${s.conflict ? 'bg-rose-50' : r?.ok ? 'bg-emerald-50/50' : 'hover:bg-sky-50/30'}`}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 align-top">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="font-mono text-[11px] text-gray-400">{m.code}</span>
                          <span className="text-gray-800 font-medium truncate max-w-[120px]" title={m.name}>{m.nickname || m.name}</span>
                          <AdminRolePicker member={m} compact />
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {g && (
                            <button type="button" title="กดเพื่อสลับกลุ่มชมพู" onClick={() => { setGroupOverride(o => ({ ...o, [m.id]: g === 'A' ? 'B' : 'A' })); reset(); }}
                              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${g === 'A' ? 'bg-pink-100 text-pink-800' : 'bg-blue-100 text-blue-800'}`}>
                              {groupOverride[m.id] && <Lock size={9} />}{groupLabel(g)}
                            </button>
                          )}
                          {m.admin_role === 'lifter' ? (
                            <label className="inline-flex items-center gap-1 text-[10px] text-orange-700">
                              เป้า
                              <input type="number" min={0} step={50} className="w-14 rounded border border-orange-200 px-1 py-0 text-right text-[11px]"
                                value={lifterOverride[m.id] ?? Math.round(plan.targetSets[m.id] || 0)}
                                onChange={e => { const v = parseFloat(e.target.value); setLifterOverride(o => { const n = { ...o }; if (Number.isFinite(v)) n[m.id] = v; else delete n[m.id]; return n; }); reset(); }} />
                              ชุด
                            </label>
                          ) : (
                            <span className="text-[10px] text-gray-400">เป้า {fmt(plan.targetSets[m.id] || 0)} ชุด · น้ำหนัก {weightOf(m.admin_role, st)}</span>
                          )}
                          {r && <span className={`text-[10px] ${r.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{r.ok ? '✓ ' : '✗ '}{r.msg}</span>}
                        </div>
                      </td>
                      {live.map(p => {
                        const edited = edits[m.id]?.[p.id] !== undefined;
                        return (
                          <td key={p.id} className="px-1 py-1 border-l first:border-l-0">
                            <input type="number" inputMode="numeric" min={0} step={st.step} aria-label={`${m.name} ${p.name}`}
                              className={`w-[72px] rounded-md border px-1.5 py-1 text-right outline-none focus:ring-2 focus:ring-sky-300 ${edited ? 'border-amber-300 bg-amber-50' : cell(m.id, p.id) ? 'border-gray-200' : 'border-transparent text-gray-300'}`}
                              value={cell(m.id, p.id) || ''} placeholder="–" disabled={!!r?.ok}
                              onChange={e => { const v = Math.max(0, parseFloat(e.target.value) || 0); setEdits(x => ({ ...x, [m.id]: { ...(x[m.id] || {}), [p.id]: v } })); }} />
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right border-l text-gray-700">{fmt(s.sets)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-gray-800">{fmt(s.wage)}</td>
                      <td className={`px-3 py-1.5 text-right text-xs ${Math.abs(s.wps - plan.avgWagePerSet) > 0.08 * plan.avgWagePerSet ? 'text-amber-600 font-semibold' : 'text-gray-500'}`}>{s.wps.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="text-xs">
                <tr className="bg-gray-50 font-semibold">
                  <td className="sticky left-0 bg-gray-50 px-3 py-2">รวมที่แจก</td>
                  {live.map(p => <td key={p.id} className="px-2 py-2 text-right border-l first:border-l-0">{fmt(totalOf(p.id))}</td>)}
                  <td className="px-2 py-2 text-right border-l">{fmt(members.reduce((s, m) => s + stats[m.id].sets, 0))}</td>
                  <td className="px-2 py-2 text-right">{fmt(members.reduce((s, m) => s + stats[m.id].wage, 0))}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{plan.avgWagePerSet.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="sticky left-0 bg-white px-3 py-2 text-gray-500">คงเหลือไว้ (ไม่แจก)</td>
                  {live.map(p => { const r = numQty[p.id] - totalOf(p.id); return (
                    <td key={p.id} className={`px-2 py-2 text-right border-l first:border-l-0 font-semibold ${Math.abs(r) < 0.001 ? 'text-emerald-600' : r > 0 ? 'text-amber-600' : 'text-rose-600'}`}>{Math.abs(r) < 0.001 ? '✓ 0' : r > 0 ? `เหลือ ${fmt(r)}` : `เกิน ${fmt(-r)}`}</td>
                  ); })}
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ปุ่มสร้างใบเบิก */}
        {live.length > 0 && members.length > 0 && (
          <div className="px-4 py-3 border-t flex items-center gap-3 flex-wrap bg-white">
            <label className="text-sm text-gray-600 flex items-center gap-2">วันที่เบิก <input type="date" className="input !w-auto" value={date} onChange={e => setDate(e.target.value)} /></label>
            {conflicts.length > 0 && <span className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle size={13} /> {conflicts.map(m => m.code).join(', ')} ได้ทั้ง {st.exclusive.join(' และ ')}</span>}
            {doneCount > 0 && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} /> สร้างใบเบิกแล้ว {doneCount} คน</span>}
            <button type="button" className="btn-primary ml-auto flex items-center gap-2 min-h-[44px]" disabled={saving} onClick={createIssues}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />} สร้างใบเบิกตามแผน
            </button>
          </div>
        )}
      </section>

      <details className="text-xs text-gray-500 card">
        <summary className="cursor-pointer font-medium text-gray-600">ระบบแจกงานอย่างไร</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5 leading-relaxed">
          <li><b>สมาชิกทั่วไป</b> (ไม่ได้รับแต่งตั้ง) ที่ได้งานประเภทเดียวกัน ได้จำนวน <b>เท่ากันทุกคน</b> — เศษที่แบ่งให้เท่ากันไม่ได้ <b>คงเหลือไว้</b> ไม่แจก (แถว "คงเหลือไว้" ท้ายตาราง)</li>
          <li>คนที่ได้รับแต่งตั้งได้มากกว่า: แอดมินทั่วไป {st.admin_weight} เท่าของคนทั่วไป · คนยกงานอยู่ในช่วง {fmt(st.lifter_min)}–{fmt(st.lifter_max)} ชุด (งานมากได้ใกล้ {fmt(st.lifter_max)} งานน้อยได้ใกล้ {fmt(st.lifter_min)})</li>
          <li>{st.exclusive.join(' กับ ')} ไม่ให้คนเดียวกัน — แบ่งเป็น 2 กลุ่มตามค่าแรงรวมของงานแต่ละแบบ คนที่เคยรับงานไหนล่าสุดอยู่กลุ่มเดิม (กดป้ายกลุ่มที่ชื่อเพื่อสลับเองได้) · ในกลุ่มเดียวกันได้เท่ากัน</li>
          <li>งานหนัก {st.heavy} กระจายให้ทุกคนเท่า ๆ กัน (ไม่มีใครได้แต่งานหนัก) — ช่อง ฿/ชุด สีส้ม = ค่าแรงต่อชุดต่างจากค่าเฉลี่ยเกิน 8%</li>
          <li>ปัดเป็นจำนวนเต็มทีละ {fmt(st.step)} เส้น · ยาว/สั้นของรุ่นเดียวกันได้เท่ากันเสมอ · แก้ตัวเลขในตารางเองได้ทุกช่อง (เช่น จะแจกเศษที่เหลือให้ใครเพิ่ม)</li>
        </ul>
      </details>

      {showSettings && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div role="dialog" aria-labelledby="ps-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center"><h3 id="ps-title" className="font-bold text-gray-800 flex-1">ตั้งค่าการแจกงาน</h3><button type="button" onClick={() => setShowSettings(false)} aria-label="ปิด" className="text-gray-400"><X size={18} /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <Num label="คนยกงาน ขั้นต่ำ (ชุด/วัน)" v={st.lifter_min} on={v => setSt({ ...st, lifter_min: v })} />
              <Num label="คนยกงาน สูงสุด (ชุด/วัน)" v={st.lifter_max} on={v => setSt({ ...st, lifter_max: v })} />
              <Num label="น้ำหนักคนยกงาน (เท่าของคนทั่วไป)" v={st.lifter_weight} step={0.1} on={v => setSt({ ...st, lifter_weight: v })} />
              <Num label="น้ำหนักแอดมินทั่วไป (เท่า)" v={st.admin_weight} step={0.1} on={v => setSt({ ...st, admin_weight: v })} />
              <div>
                <span className="label">ปัดจำนวนทีละ</span>
                <select className="input" value={st.step} onChange={e => setSt({ ...st, step: Number(e.target.value) })}>
                  {[10, 50, 100, 250].map(n => <option key={n} value={n}>{n} เส้น</option>)}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-gray-500">น้ำหนักคนยกงานใช้หาจุดเริ่ม แล้วบีบให้อยู่ในช่วงขั้นต่ำ–สูงสุด · แอดมินทั่วไปควรมากกว่า 1 แต่น้อยกว่าน้ำหนักคนยกงาน</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowSettings(false)}>ใช้เฉพาะครั้งนี้</button>
              <button type="button" className="btn-primary" onClick={saveSettings}>บันทึกเป็นค่าเริ่มต้น</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 border ${ok ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-200'}`}>
      <p className={`text-[11px] ${ok ? 'text-emerald-700' : 'text-amber-700'} flex items-center gap-1`}>{ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {label}</p>
      <p className="text-sm font-semibold text-gray-800 tabular-nums">{value}</p>
    </div>
  );
}

function Num({ label, v, on, step = 1 }: { label: string; v: number; on: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" step={step} min={0} className="input text-right" value={v} onChange={e => on(parseFloat(e.target.value) || 0)} />
    </label>
  );
}
