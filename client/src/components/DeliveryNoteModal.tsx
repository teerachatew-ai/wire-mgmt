import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Check, Minus, Plus, FileText, Truck, Loader2, Trash2, AlertTriangle, CheckCircle2, PackagePlus } from 'lucide-react';
import { productApi, shipmentApi } from '../api';
import { openDownloadTab, downloadBlob } from '../utils/downloadBlob';

/* ── ทำใบส่งของ ─────────────────────────────────────────────────────────────
   ① ติ๊กรุ่นที่จะส่งวันนี้  ② ใส่จำนวนเส้น/ลัง × จำนวนลัง (เพิ่มลังเศษได้)  ③ สร้างใบส่งสินค้า PDF / ยืนยันบันทึกยอดส่งเข้าระบบ
   PDF = แบบฟอร์มว่างของ Amphenol เติมจำนวนรวมต่อรุ่น + วันที่ส่ง (server: POST /shipments/delivery-note-pdf)
   ร่างที่กรอกค้างไว้เก็บในเครื่อง (ปิดหน้าต่างแล้วเปิดใหม่ยังอยู่) — ล้างเมื่อบันทึกสำเร็จ */

type Line = { per_box: string; boxes: string };
type Draft = { date: string; sel: Record<number, Line[]> };

const DRAFT_KEY = 'wire_delivery_note_draft';
const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const n = (v: any) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lineQty = (l: Line) => n(l.per_box) * Math.floor(n(l.boxes));
const readDraft = (): Draft | null => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.sel ? d : null; } catch { return null; } };
const writeDraft = (d: Draft | null) => { try { d ? localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) : localStorage.removeItem(DRAFT_KEY); } catch { /* โหมดส่วนตัว */ } };

export default function DeliveryNoteModal({ products, onClose }: { products: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: master = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const draft = useMemo(readDraft, []);
  const [date, setDate] = useState(draft?.date || todayLocal());
  const [sel, setSel] = useState<Record<number, Line[]>>(draft?.sel || {});
  const [busy, setBusy] = useState<'' | 'pdf' | 'save'>('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState<{ code: string } | null>(null);

  useEffect(() => { if (!saved) writeDraft({ date, sel }); }, [date, sel, saved]);

  // รวมข้อมูลสต็อกพร้อมส่ง (stock-flow) กับมาตรฐานบรรจุ (ประเภทสินค้า)
  const rows = useMemo(() => {
    const m = new Map((master as any[]).map(p => [p.id, p]));
    return products
      .filter(p => m.get(p.id)?.active !== 0)
      .map(p => ({ ...p, units_per_box: Number(m.get(p.id)?.units_per_box) || 0, project: p.project || m.get(p.id)?.project || '' }));
  }, [products, master]);
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const p of rows) { const k = p.project || 'อื่นๆ'; g.set(k, [...(g.get(k) || []), p]); }
    return [...g.entries()];
  }, [rows]);

  const picked = rows.filter(p => sel[p.id]);
  const qtyOf = (id: number) => (sel[id] || []).reduce((s, l) => s + lineQty(l), 0);
  const boxesOf = (id: number) => (sel[id] || []).reduce((s, l) => s + (n(l.per_box) ? Math.floor(n(l.boxes)) : 0), 0);
  const totalQty = picked.reduce((s, p) => s + qtyOf(p.id), 0);
  const totalBoxes = picked.reduce((s, p) => s + boxesOf(p.id), 0);
  const ready = picked.length > 0 && picked.every(p => qtyOf(p.id) > 0);
  const overList = picked.filter(p => qtyOf(p.id) > (p.available ?? 0));

  const toggle = (p: any) => setSel(s => {
    const next = { ...s };
    if (next[p.id]) { delete next[p.id]; return next; }
    const per = p.units_per_box || 0;
    const full = per > 0 ? Math.floor((p.available ?? 0) / per) : 0;
    next[p.id] = [{ per_box: per ? String(per) : '', boxes: String(Math.max(1, full)) }];
    return next;
  });
  const setLine = (id: number, i: number, patch: Partial<Line>) =>
    setSel(s => ({ ...s, [id]: s[id].map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const addLine = (id: number, per = '') => setSel(s => ({ ...s, [id]: [...s[id], { per_box: per, boxes: '1' }] }));
  const removeLine = (id: number, i: number) => setSel(s => ({ ...s, [id]: s[id].filter((_, k) => k !== i) }));
  const step = (id: number, i: number, d: number) =>   // อ่านค่าล่าสุดใน updater — กดรัวๆ ไม่ตกหล่น
    setSel(s => ({ ...s, [id]: s[id].map((l, k) => (k === i ? { ...l, boxes: String(Math.max(0, Math.floor(n(l.boxes)) + d)) } : l)) }));

  const payloadItems = () => picked.map(p => ({
    product_id: p.id,
    lines: sel[p.id].filter(l => lineQty(l) > 0).map(l => ({ per_box: n(l.per_box), boxes: Math.floor(n(l.boxes)) })),
  }));

  const makePdf = async () => {
    const tab = openDownloadTab();   // เปิดแท็บทันทีตอนกด (Safari/iPhone บล็อกหน้าต่างที่เปิดหลังรอ server)
    try { tab?.document.write('<p style="font-family:sans-serif;padding:24px">กำลังสร้างใบส่งสินค้า…</p>'); } catch { /* */ }
    setBusy('pdf'); setErr('');
    try {
      const blob = await shipmentApi.deliveryNotePdf({ date, items: payloadItems() });
      const file = new Blob([blob], { type: 'application/pdf' });
      if (tab && !tab.closed) {
        // เปิด PDF ในแท็บ — PC/Mac กดพิมพ์ได้เลย · iPhone กดปุ่มแชร์ → พิมพ์ / บันทึกลงไฟล์
        const url = URL.createObjectURL(file);
        tab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      } else {
        downloadBlob(file, `ใบส่งสินค้า-${date}.pdf`);
      }
    } catch (e: any) {
      tab?.close();
      let msg = 'สร้างใบส่งสินค้าไม่สำเร็จ';
      try { const t = await e?.response?.data?.text?.(); msg = JSON.parse(t).error || msg; } catch { /* */ }
      setErr(msg);
    } finally { setBusy(''); }
  };

  const save = async () => {
    const lines = picked.map(p => `• ${p.name}: ${fmt(boxesOf(p.id))} ลัง = ${fmt(qtyOf(p.id))} ${p.unit || 'เส้น'}`).join('\n');
    const warn = overList.length ? `\n\n⚠ เกินสต็อกพร้อมส่ง: ${overList.map(p => p.name).join(', ')}` : '';
    if (!confirm(`ยืนยันบันทึกส่งงานวันที่ ${date.split('-').reverse().join('/')}\n\n${lines}\n\nรวม ${fmt(totalBoxes)} ลัง · ${fmt(totalQty)} เส้น${warn}`)) return;
    setBusy('save'); setErr('');
    try {
      const notes = 'ใบส่งของ · ' + picked.map(p =>
        `${String(p.name).replace(/\s*\(.*$/, '')} ${sel[p.id].filter(l => lineQty(l) > 0).map(l => `${Math.floor(n(l.boxes))}×${fmt(n(l.per_box))}`).join('+')}`).join(' · ');
      const r = await shipmentApi.create({
        shipped_at: date, notes,
        items: picked.map(p => ({ product_id: p.id, good_qty: qtyOf(p.id), defect_qty: 0 })),
      });
      setSaved({ code: r.code });
      writeDraft(null);
      qc.invalidateQueries({ queryKey: ['stock-flow'] });
      qc.invalidateQueries({ queryKey: ['shipments'] });
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const clearAll = () => { if (confirm('ล้างรายการที่เลือกทั้งหมด?')) setSel({}); };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-labelledby="dn-title" onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-2xl h-[100dvh] md:h-auto md:max-h-[92vh] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* หัว */}
        <div className="px-4 md:px-5 pt-4 pb-3 border-b bg-gradient-to-b from-sky-50 to-white">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-sky-100 text-sky-700"><FileText size={18} /></span>
            <h2 id="dn-title" className="font-bold text-lg text-slate-800 flex-1">ทำใบส่งของ</h2>
            <button type="button" onClick={onClose} aria-label="ปิด" className="p-2 -mr-2 text-slate-400 hover:text-slate-700"><X size={20} /></button>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-600" htmlFor="dn-date">วันที่ส่ง</label>
            <input id="dn-date" type="date" className="input !w-auto" value={date} disabled={!!saved} onChange={e => setDate(e.target.value)} />
            <span className="text-xs text-slate-400">① ติ๊กรุ่นที่ส่ง → ② ใส่จำนวนลัง → ③ สร้างใบส่งของ / ยืนยันบันทึก</span>
          </div>
        </div>

        {/* รายการรุ่น */}
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-3 space-y-4 bg-slate-50/60">
          {saved && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2 text-sm text-emerald-800">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>บันทึกส่งงานเข้าระบบแล้ว เลขที่ <b>{saved.code}</b> — ยังกด "สร้างใบส่งของ" เพื่อพิมพ์ได้</div>
            </div>
          )}
          {groups.map(([proj, list]) => (
            <section key={proj}>
              <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 px-1 mb-1.5">{proj}</h3>
              <div className="space-y-2">
                {list.map((p: any) => {
                  const on = !!sel[p.id];
                  const q = qtyOf(p.id);
                  const avail = p.available ?? 0;
                  const over = on && !saved && q > avail;   // หลังบันทึก สต็อกถูกหักแล้ว ไม่ต้องเตือน
                  const per0 = n(sel[p.id]?.[0]?.per_box);
                  const rem = on ? avail - q : 0;
                  return (
                    <div key={p.id} className={`rounded-xl border bg-white transition ${on ? 'border-sky-400 ring-2 ring-sky-100' : 'border-slate-200'}`}>
                      <button type="button" disabled={!!saved} onClick={() => toggle(p)} aria-pressed={on}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left min-h-[56px] disabled:cursor-default">
                        <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300'}`}>
                          {on && <Check size={16} strokeWidth={3} />}
                        </span>
                        {p.color && <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: p.color }} />}
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-slate-800 leading-tight">{p.name}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            พร้อมส่ง <b className={avail > 0 ? 'text-emerald-700' : 'text-slate-400'}>{fmt(avail)}</b>
                            {p.units_per_box ? <> · มาตรฐาน {fmt(p.units_per_box)}/ลัง</> : null}
                          </span>
                        </span>
                        {on && q > 0 && (
                          <span className="text-right shrink-0">
                            <span className="block font-bold text-sky-700 tabular-nums">{fmt(q)}</span>
                            <span className="block text-[11px] text-slate-500">{fmt(boxesOf(p.id))} ลัง</span>
                          </span>
                        )}
                      </button>

                      {on && (
                        <div className="px-3 pb-3 space-y-2">
                          {sel[p.id].map((l, i) => (
                            <div key={i} className="flex items-center gap-2 flex-wrap bg-slate-50 rounded-lg px-2 py-2">
                              <div className="flex items-center gap-1">
                                <input type="number" inputMode="numeric" min="1" className="input !w-24 text-right tabular-nums" placeholder="เส้น"
                                  value={l.per_box} disabled={!!saved} aria-label="จำนวนเส้นต่อลัง"
                                  onChange={e => setLine(p.id, i, { per_box: e.target.value })} />
                                <span className="text-xs text-slate-500">เส้น/ลัง</span>
                              </div>
                              <span className="text-slate-400">×</span>
                              <div className="flex items-center">
                                <button type="button" disabled={!!saved} onClick={() => step(p.id, i, -1)} aria-label="ลดลัง"
                                  className="w-10 h-10 rounded-l-lg border border-slate-300 bg-white flex items-center justify-center text-slate-600 active:bg-slate-100"><Minus size={16} /></button>
                                <input type="number" inputMode="numeric" min="0" className="w-14 h-10 border-y border-slate-300 text-center tabular-nums font-semibold outline-none focus:bg-sky-50"
                                  value={l.boxes} disabled={!!saved} aria-label="จำนวนลัง"
                                  onChange={e => setLine(p.id, i, { boxes: e.target.value })} onFocus={e => e.target.select()} />
                                <button type="button" disabled={!!saved} onClick={() => step(p.id, i, 1)} aria-label="เพิ่มลัง"
                                  className="w-10 h-10 rounded-r-lg border border-slate-300 bg-white flex items-center justify-center text-slate-600 active:bg-slate-100"><Plus size={16} /></button>
                              </div>
                              <span className="text-xs text-slate-500">ลัง</span>
                              <span className="ml-auto font-semibold tabular-nums text-slate-700">= {fmt(lineQty(l))}</span>
                              {sel[p.id].length > 1 && !saved && (
                                <button type="button" onClick={() => removeLine(p.id, i)} aria-label="ลบบรรทัดนี้" className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
                              )}
                            </div>
                          ))}
                          {!saved && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <button type="button" onClick={() => addLine(p.id)} className="text-xs text-sky-700 hover:underline flex items-center gap-1 py-1">
                                <PackagePlus size={14} /> เพิ่มลังเศษ / ขนาดลังอื่น
                              </button>
                              {rem > 0 && per0 > 0 && rem < per0 && (
                                <button type="button" onClick={() => addLine(p.id, String(rem))}
                                  className="text-xs rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 hover:bg-amber-100">
                                  สต็อกเหลือเศษ {fmt(rem)} เส้น — ใส่เป็นลังเศษ 1 ลัง
                                </button>
                              )}
                            </div>
                          )}
                          {over && (
                            <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle size={13} /> มากกว่าสต็อกพร้อมส่ง ({fmt(avail)}) อยู่ {fmt(q - avail)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* สรุป + ปุ่ม */}
        <div className="border-t bg-white px-4 md:px-5 py-3 space-y-2.5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-slate-600">{picked.length} รุ่น</span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-slate-800 tabular-nums">{fmt(totalBoxes)} ลัง</span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-sky-700 tabular-nums">{fmt(totalQty)} เส้น</span>
            {picked.length > 0 && !saved && (
              <button type="button" onClick={clearAll} className="ml-auto text-xs text-slate-400 hover:text-rose-600">ล้างทั้งหมด</button>
            )}
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary flex items-center justify-center gap-2 min-h-[48px]" disabled={!ready || !!busy} onClick={makePdf}>
              {busy === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} สร้างใบส่งของ
            </button>
            {saved ? (
              <button type="button" className="btn-primary min-h-[48px]" onClick={onClose}>เสร็จสิ้น</button>
            ) : (
              <button type="button" className="btn-primary flex items-center justify-center gap-2 min-h-[48px] !bg-emerald-600 hover:!bg-emerald-700" disabled={!ready || !!busy} onClick={save}>
                {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />} ยืนยันบันทึกส่งงาน
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
