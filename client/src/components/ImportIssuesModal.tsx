import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { X, Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { issueApi, memberApi, productApi, receiveApi, ocrApi } from '../api';
import { sortByColorGroup } from '../productOrder';
import { parseProductLabel } from '../projectLabel';

/* ── นำเข้าใบเบิกจากรูป / PDF / Excel (ใบรายชื่อผู้รับสายไฟรายวัน) ──
   1) เลือกไฟล์ + วันที่เบิก → server อ่านใบด้วย AI แล้วจับคู่ชื่อ→สมาชิก, หัวคอลัมน์→ชนิดงาน
   2) ตรวจ/แก้ในตาราง (เปลี่ยนสมาชิก แก้จำนวน ติ๊กออกได้) — ชื่อที่จับคู่ไม่ได้/ไม่มั่นใจ ขึ้นสีส้ม
   3) บันทึก = สร้างใบเบิกทีละคน (/issues/batch — กติกาเดียวกับสร้างใบเบิกปกติ: เพดานคงค้าง/งานค้างเกินกำหนด)
   ล็อต: ล็อตเก่าสุดที่ยังมีของ (ถ้าหมดทุกล็อต = ล็อตล่าสุดที่มาถึงแล้ว) */

type Row = { key: number; on: boolean; sheet_name: string; member_id: number | null; conf: string; qty: Record<number, string>; status?: 'ok' | 'err'; msg?: string };

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function ImportIssuesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: members = [] } = useQuery({ queryKey: ['members', '__all'], queryFn: () => memberApi.list() });
  const { data: lots = [] } = useQuery({ queryKey: ['receive-lots', 'all'], queryFn: () => receiveApi.lots() });
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'' | 'read' | 'save'>('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cols, setCols] = useState<number[]>([]);

  const active = useMemo(() => (members as any[]).filter(m => m.status === 'active'), [members]);
  const prodById = useMemo(() => new Map((products as any[]).map(p => [p.id, p])), [products]);
  const orderedCols = useMemo(() => sortByColorGroup(cols.map(id => prodById.get(id)).filter(Boolean) as any[], (p: any) => p.name, (p: any) => p.color).map((p: any) => p.id), [cols, prodById]);

  const lotFor = (pid: number) => {
    const mine = (lots as any[]).filter(l => l.product_id === pid).sort((a, b) => a.lot_date.localeCompare(b.lot_date));
    const withStock = mine.find(l => l.remaining_qty > 0 && l.lot_date <= date);
    if (withStock) return withStock.lot_date;
    const arrived = mine.filter(l => l.lot_date <= date);
    return arrived.length ? arrived[arrived.length - 1].lot_date : null;
  };

  const read = async () => {
    if (!file) return;
    setBusy('read'); setErr(''); setRows(null); setNote('');
    try {
      const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      let res: any;
      if (isExcel) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const csv = wb.SheetNames.slice(0, 1).map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n');
        res = await ocrApi.readIssueSheet({ csv });
      } else {
        res = await ocrApi.readIssueSheet({ file });
      }
      if (res.date && /^\d{4}-\d{2}-\d{2}$/.test(res.date)) setDate(res.date);
      const colSet = new Set<number>();
      const rs: Row[] = (res.rows || []).map((r: any, i: number) => {
        const qty: Record<number, string> = {};
        for (const l of r.lines || []) { qty[l.product_id] = String(l.qty); colSet.add(l.product_id); }
        return { key: i, on: true, sheet_name: r.sheet_name, member_id: r.member_id ?? null, conf: r.member_confidence || 'low', qty };
      });
      setCols([...colSet]);
      setRows(rs);
      setNote(res.notes || '');
      if (rs.length === 0) setErr('ไม่พบรายการเบิกในไฟล์นี้');
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'อ่านไฟล์ไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const upd = (key: number, patch: Partial<Row>) => setRows(rs => rs!.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const picked = (rows || []).filter(r => r.on && r.status !== 'ok');
  const missing = picked.filter(r => !r.member_id);
  const dupIds = (() => { const seen = new Map<number, number>(); for (const r of picked) if (r.member_id) seen.set(r.member_id, (seen.get(r.member_id) || 0) + 1); return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id)); })();
  const colTotal = (pid: number) => picked.reduce((s, r) => s + (parseFloat(r.qty[pid] || '0') || 0), 0);

  const save = async () => {
    if (!rows || missing.length || dupIds.size) return;
    setBusy('save'); setErr('');
    for (const r of picked) {
      const lines = orderedCols.map(pid => ({ product_id: pid, quantity: parseFloat(r.qty[pid] || '0') || 0, lot_date: lotFor(pid) }))
        .filter(l => l.quantity > 0);
      if (!lines.length) { upd(r.key, { status: 'err', msg: 'ไม่มีจำนวน' }); continue; }
      try {
        const res = await issueApi.createBatch({ issued_at: date, member_id: r.member_id, lines });
        const failed = (res.failed || []).length;
        upd(r.key, failed ? { status: 'err', msg: `บันทึกไม่ครบ ${failed} รายการ` } : { status: 'ok', msg: `สร้าง ${res.created.length} ใบ` });
      } catch (e: any) {
        upd(r.key, { status: 'err', msg: e?.response?.data?.error || 'บันทึกไม่สำเร็จ' });
      }
    }
    for (const k of ['issues', 'stock-flow', 'receive-lots', 'reports', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    setBusy('');
  };
  const doneCount = (rows || []).filter(r => r.status === 'ok').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-labelledby="imp-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start gap-3">
          <div className="flex-1">
            <h3 id="imp-title" className="font-bold text-gray-900">นำเข้าใบเบิกจากรูป / Excel</h3>
            <p className="text-xs text-gray-500 mt-0.5">อัปโหลดใบรายชื่อผู้รับสายไฟรายวัน ระบบอ่านชื่อและจำนวนให้ ตรวจแล้วกดบันทึก — สร้างใบเบิกให้ทุกคนในครั้งเดียว</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ไฟล์ (รูป, PDF, Excel)</span>
              <input type="file" accept="image/*,.pdf,.xlsx,.xls,.csv" className="text-sm" onChange={e => { setFile(e.target.files?.[0] || null); setRows(null); setErr(''); }} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">วันที่เบิก</span>
              <input type="date" className="input !min-h-[38px]" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <button type="button" className="btn-primary btn-sm flex items-center gap-1.5" disabled={!file || !!busy} onClick={read}>
              {busy === 'read' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {busy === 'read' ? 'กำลังอ่าน (ราว 20–40 วินาที)…' : 'อ่านไฟล์'}
            </button>
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
          {note && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2"><AlertTriangle size={13} className="inline mr-1" />ระบบแจ้ง: {note}</p>}

          {rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left">ชื่อในใบ</th>
                      <th className="px-2 py-2 text-left min-w-[200px]">สมาชิกในระบบ</th>
                      {orderedCols.map(pid => {
                        const p = prodById.get(pid); const { num, label } = parseProductLabel(p?.name || '');
                        return <th key={pid} className="px-2 py-2 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">{p?.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ background: p.color }} />}{num}</span>
                          <div className="font-normal text-[10px] text-gray-400">{label}</div>
                        </th>;
                      })}
                      <th className="px-2 py-2 text-left">ผล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const warn = r.on && (!r.member_id || r.conf === 'low' || (r.member_id && dupIds.has(r.member_id)));
                      return (
                        <tr key={r.key} className={`border-t ${!r.on ? 'opacity-40' : warn ? 'bg-amber-50/60' : ''}`}>
                          <td className="px-2 py-1 text-center"><input type="checkbox" checked={r.on} disabled={r.status === 'ok'} onChange={e => upd(r.key, { on: e.target.checked })} aria-label={`เลือก ${r.sheet_name}`} /></td>
                          <td className="px-2 py-1 whitespace-nowrap text-gray-700">{r.sheet_name}</td>
                          <td className="px-2 py-1">
                            <select className={`input !min-h-[34px] !py-0 text-sm w-full ${!r.member_id ? '!border-amber-400' : ''}`} value={r.member_id ?? ''} disabled={r.status === 'ok'}
                              onChange={e => upd(r.key, { member_id: e.target.value ? Number(e.target.value) : null, conf: 'high' })}>
                              <option value="">— เลือกสมาชิก —</option>
                              {active.map((m: any) => <option key={m.id} value={m.id}>{m.code} {m.nickname || m.name}{m.nickname ? ` (${m.name})` : ''}</option>)}
                            </select>
                            {r.member_id && dupIds.has(r.member_id) && <div className="text-[11px] text-amber-700">ชื่อซ้ำกับแถวอื่น</div>}
                            {r.member_id && r.conf === 'low' && !dupIds.has(r.member_id) && <div className="text-[11px] text-amber-700">ไม่แน่ใจ ช่วยตรวจ</div>}
                          </td>
                          {orderedCols.map(pid => (
                            <td key={pid} className="px-1 py-1">
                              <input type="number" min="0" inputMode="numeric" className="input !min-h-[34px] !py-0 !px-2 w-20 text-right" value={r.qty[pid] || ''} disabled={r.status === 'ok'}
                                onChange={e => upd(r.key, { qty: { ...r.qty, [pid]: e.target.value } })} />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-xs whitespace-nowrap">
                            {r.status === 'ok' && <span className="text-emerald-700"><CheckCircle2 size={13} className="inline mr-0.5" />{r.msg}</span>}
                            {r.status === 'err' && <span className="text-rose-600">{r.msg}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 bg-gray-50 font-semibold">
                      <td></td><td className="px-2 py-2" colSpan={2}>รวมที่จะเบิก ({picked.length} คน)</td>
                      {orderedCols.map(pid => <td key={pid} className="px-2 py-2 text-right">{colTotal(pid).toLocaleString('th-TH')}</td>)}
                      <td></td>
                    </tr>
                    <tr className="text-[11px] text-gray-500">
                      <td></td><td className="px-2 py-1" colSpan={2}>ล็อตที่จะใช้</td>
                      {orderedCols.map(pid => <td key={pid} className="px-2 py-1 text-right">{lotFor(pid) || '—'}</td>)}
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {(missing.length > 0 || dupIds.size > 0) && (
                <p className="text-sm text-amber-700">
                  {missing.length > 0 && <>ยังไม่ได้เลือกสมาชิก {missing.length} แถว (เลือก หรือติ๊กออก) </>}
                  {dupIds.size > 0 && <>· มีสมาชิกซ้ำกันหลายแถว</>}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t px-5 py-3 flex items-center gap-2 justify-end">
          {doneCount > 0 && <span className="text-sm text-emerald-700 mr-auto">สร้างใบเบิกแล้ว {doneCount} คน</span>}
          <button type="button" className="btn-secondary" onClick={onClose}>{doneCount ? 'ปิด' : 'ยกเลิก'}</button>
          {rows && rows.length > 0 && (
            <button type="button" className="btn-primary disabled:opacity-40" disabled={!!busy || picked.length === 0 || missing.length > 0 || dupIds.size > 0} onClick={save}>
              {busy === 'save' ? 'กำลังบันทึก…' : `บันทึกใบเบิก ${picked.length} คน (${date})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
