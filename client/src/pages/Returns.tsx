import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { returnApi, issueApi } from '../api';
import { Plus, X, RotateCcw, AlertTriangle, Edit2, Trash2 } from 'lucide-react';

// วันที่แบบสั้น dd/mm/yyyy (พ.ศ.)
function fmtDate(s: string) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
}

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ── Edit Return Modal ── */
function EditReturnModal({ ret, onClose, onSaved }: any) {
  const { register, handleSubmit } = useForm<any>({
    defaultValues: {
      returned_at: ret.returned_at,
      good_qty: ret.good_qty,
      ng_cut: ret.ng_cut ?? ret.defect_qty ?? 0,
      ng_factory: ret.ng_factory ?? 0,
      waste_qty: ret.waste_qty,
      inspector: ret.inspector || '',
      notes: ret.notes || '',
    }
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: any) => {
    setLoading(true); setError('');
    try {
      await returnApi.update(ret.id, data);
      onSaved(); onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  };

  return (
    <Modal title={`แก้ไขรับคืน ${ret.code}`} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p><span className="text-gray-500">อ้างใบเบิก: </span><strong className="text-blue-600">{ret.issue_code}</strong> — {ret.member_name}</p>
          <p className="text-gray-500 text-xs mt-0.5">{ret.product_name}</p>
        </div>
        <div>
          <label className="label">วันที่คืน *</label>
          <input type="date" className="input" {...register('returned_at', { required: true })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">งานดี *</label>
            <input type="number" step="0.01" min="0" className="input" {...register('good_qty', { required: true })} />
          </div>
          <div>
            <label className="label">เศษคืน</label>
            <input type="number" step="0.01" min="0" className="input" {...register('waste_qty')} />
          </div>
          <div>
            <label className="label text-rose-600">งานเสีย — จากการตัด (หักเงิน)</label>
            <input type="number" step="0.01" min="0" className="input" {...register('ng_cut')} />
          </div>
          <div>
            <label className="label text-amber-600">งานเสีย — จากโรงงาน (จ่ายปกติ)</label>
            <input type="number" step="0.01" min="0" className="input" {...register('ng_factory')} />
          </div>
        </div>
        <div>
          <label className="label">ผู้ตรวจรับ</label>
          <input className="input" {...register('inspector')} />
        </div>
        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" {...register('notes')} />
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Delete Return Dialog ── */
function DeleteReturnDialog({ ret, onClose, onDeleted }: any) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const doDelete = async () => {
    setLoading(true); setError('');
    try { await returnApi.delete(ret.id); onDeleted(); onClose(); }
    catch (e: any) { setError(e.response?.data?.error || 'เกิดข้อผิดพลาด'); setLoading(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-100 rounded-lg shrink-0"><Trash2 size={20} className="text-red-600" /></div>
          <div>
            <h3 className="font-semibold text-gray-800">ลบรายการรับคืน</h3>
            <p className="text-sm text-gray-500 mt-0.5">{ret.code} — {ret.member_name}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">ลบรายการคืนนี้? สถานะใบเบิกจะถูกคำนวณใหม่อัตโนมัติ</p>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>ยกเลิก</button>
          <button className="btn-danger" onClick={doDelete} disabled={loading}>{loading ? 'กำลังลบ...' : 'ลบ'}</button>
        </div>
      </div>
    </div>
  );
}

import DaySummary from '../components/DaySummary';

export default function Returns() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [searchIssue, setSearchIssue] = useState('');
  const [issueDayFilter, setIssueDayFilter] = useState('');   // filter ตามวันที่เบิก
  const [lines, setLines] = useState<any[]>([]); // { issue, good_qty, ng_cut, ng_factory, waste_qty }
  const [saving, setSaving] = useState(false);
  const [editingReturn, setEditingReturn] = useState<any>(null);
  const [deletingReturn, setDeletingReturn] = useState<any>(null);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['returns'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['issues-open'] });
    qc.invalidateQueries({ queryKey: ['issues-partial'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const [dayFilter, setDayFilter] = useState('');
  const { data: returns_ = [], isLoading } = useQuery({ queryKey: ['returns', dayFilter], queryFn: () => returnApi.list({ date: dayFilter || undefined }) });
  const { data: openIssues = [] } = useQuery({
    queryKey: ['issues-open'],
    queryFn: () => issueApi.list({ status: 'pending' })
  });
  const { data: partialIssues = [] } = useQuery({
    queryKey: ['issues-partial'],
    queryFn: () => issueApi.list({ status: 'partial' })
  });

  const allOpenIssues = [...(openIssues as any[]), ...(partialIssues as any[])];
  const filtered = (searchIssue
    ? allOpenIssues.filter((i: any) => {
        const q = searchIssue.toLowerCase();
        return i.code.toLowerCase().includes(q)
          || i.member_name.toLowerCase().includes(q)
          || i.member_code.toLowerCase().includes(q)
          || (i.member_nickname ?? '').toLowerCase().includes(q);
      })
    : allOpenIssues
  )
    .filter((i: any) => !issueDayFilter || String(i.issued_at || '').slice(0, 10) === issueDayFilter)  // filter วันที่เบิก
    .filter((i: any) => !lines.some(l => l.issue.id === i.id))  // ซ่อนใบที่เลือกแล้ว
    .sort((a: any, b: any) => String(b.issued_at || '').localeCompare(String(a.issued_at || '')));     // ใบเบิกล่าสุดขึ้นก่อน

  // วันที่เบิกที่มีใบค้างอยู่ (ให้เลือกใน dropdown พร้อมจำนวนใบ)
  const issueDays = Object.entries(allOpenIssues.reduce((a: any, i: any) => {
    const d = String(i.issued_at || '').slice(0, 10);
    if (d) a[d] = (a[d] || 0) + 1;
    return a;
  }, {})).sort((x, y) => y[0].localeCompare(x[0])) as [string, number][];

  const { register, handleSubmit, reset } = useForm<any>({
    defaultValues: { returned_at: new Date().toISOString().split('T')[0] }
  });

  const remainOf = (i: any) => i.quantity - (i.returned_good + i.returned_defect + i.returned_waste);
  // ค่าเริ่มต้น = คืนครบ ไม่มีงานเสีย (งานดี = คงเหลือ) — hasDefect=false จะซ่อนช่องกรอกตัวเลข
  const addIssue = (i: any) => { setLines(l => [...l, { issue: i, good_qty: remainOf(i), ng_cut: 0, ng_factory: 0, waste_qty: 0, hasDefect: false }]); setSearchIssue(''); };
  const removeIssue = (id: number) => setLines(l => l.filter(x => x.issue.id !== id));
  const updateLine = (id: number, field: string, val: any) =>
    setLines(l => l.map(x => x.issue.id === id ? { ...x, [field]: val } : x));
  // สลับโหมด "มีงานเสีย": เปิด = ให้กรอกเอง · ปิด = คืนครบ (งานดี=คงเหลือ, เสีย/เศษ=0)
  const toggleDefect = (i: any, on: boolean) =>
    setLines(l => l.map(x => x.issue.id === i.id
      ? (on ? { ...x, hasDefect: true } : { ...x, hasDefect: false, good_qty: remainOf(i), ng_cut: 0, ng_factory: 0, waste_qty: 0 })
      : x));
  const lineTotal = (l: any) => (parseFloat(l.good_qty) || 0) + (parseFloat(l.ng_cut) || 0) + (parseFloat(l.ng_factory) || 0) + (parseFloat(l.waste_qty) || 0);

  const closeModal = () => { setShowModal(false); setError(''); setWarning(''); setLines([]); setSearchIssue(''); setIssueDayFilter(''); reset(); };

  const submit = handleSubmit(async (shared: any) => {
    if (lines.length === 0) { setError('กรุณาเลือกใบเบิกอย่างน้อย 1 ใบ'); return; }
    setSaving(true); setError('');
    const warnings: string[] = [];
    try {
      for (const l of lines) {
        const res = await returnApi.create({
          issue_id: l.issue.id, returned_at: shared.returned_at,
          good_qty: l.good_qty || 0, ng_cut: l.ng_cut || 0, ng_factory: l.ng_factory || 0, waste_qty: l.waste_qty || 0,
          inspector: shared.inspector, notes: shared.notes,
        });
        if (res.defect_warning) warnings.push(`${l.issue.code}: ${res.defect_warning}`);
      }
      refetchAll();
      if (warnings.length) { setWarning(warnings.join('\n')); setLines([]); }
      else { closeModal(); }
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCcw size={20} className="text-green-600" />
          <h1 className="text-xl font-bold text-gray-800">รับคืนงาน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" className="input w-40 text-sm" value={dayFilter} onChange={e => setDayFilter(e.target.value)} title="ดูเฉพาะวันที่คืน" />
          {dayFilter && <button className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={() => setDayFilter('')}>ล้างวันที่</button>}
          <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => { setShowModal(true); setWarning(''); }}>
            <Plus size={16} /> บันทึกรับคืน
          </button>
        </div>
      </div>

      <DaySummary
        groups={Object.values((returns_ as any[]).reduce((a: any, r: any) => {
          const k = r.product_name; (a[k] ??= { name: k, qty: 0 }).qty += Number(r.good_qty) || 0; return a;
        }, {})) as any[]}
        note={dayFilter || 'ทั้งหมด'} unitLabel="งานดีคืน" />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">เลขที่คืน</th>
              <th className="px-4 py-3 font-medium">อ้างใบเบิก</th>
              <th className="px-4 py-3 font-medium">วันที่คืน</th>
              <th className="px-4 py-3 font-medium">สมาชิก</th>
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 font-medium text-right">งานดี</th>
              <th className="px-4 py-3 font-medium text-right text-rose-500">เสีย-ตัด</th>
              <th className="px-4 py-3 font-medium text-right text-amber-600">เสีย-โรงงาน</th>
              <th className="px-4 py-3 font-medium text-right">เศษ</th>
              <th className="px-4 py-3 font-medium">ผู้ตรวจ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={11} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {(returns_ as any[]).map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-green-600 font-semibold">{r.code}</td>
                <td className="px-4 py-3 font-mono text-xs text-blue-600">{r.issue_code}</td>
                <td className="px-4 py-3 text-gray-600">{r.returned_at}{r.created_by && <div className="text-xs text-gray-400">โดย {r.created_by}</div>}</td>
                <td className="px-4 py-3 text-gray-800">{r.member_name}</td>
                <td className="px-4 py-3 text-gray-600"><span className="inline-flex items-center gap-1.5">{r.product_color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.product_color }} />}{r.product_name}</span></td>
                <td className="px-4 py-3 text-right font-medium text-green-600">{r.good_qty}</td>
                <td className="px-4 py-3 text-right font-medium text-rose-500">{r.ng_cut ?? r.defect_qty}</td>
                <td className="px-4 py-3 text-right font-medium text-amber-600">{r.ng_factory ?? 0}</td>
                <td className="px-4 py-3 text-right text-gray-500">{r.waste_qty}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.inspector || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button className="text-gray-400 hover:text-amber-600" onClick={() => setEditingReturn(r)}><Edit2 size={15} /></button>
                    <button className="text-gray-400 hover:text-red-600" onClick={() => setDeletingReturn(r)}><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && (returns_ as any[]).length === 0 && <tr><td colSpan={11} className="py-8 text-center text-gray-400">ยังไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="บันทึกรับคืนงาน" onClose={closeModal}>
          {warning ? (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">แจ้งเตือนของเสีย</p>
                  <p className="text-sm text-amber-700 mt-1 whitespace-pre-line">{warning}</p>
                  <p className="text-xs text-amber-600 mt-2">บันทึกเรียบร้อยแล้ว กรุณาแจ้งสมาชิกก่อนรับเบิกครั้งถัดไป</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-primary" onClick={closeModal}>รับทราบ</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">วันที่คืน *</label>
                <input type="date" className="input" {...register('returned_at', { required: true })} />
              </div>

              {/* Add outstanding issues — search + date filter + list */}
              <div>
                <label className="label">เพิ่มใบเบิกที่จะรับคืน ({filtered.length} ใบที่เลือกได้)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className="input" placeholder="🔍 ค้นหา เลขที่ / ชื่อ-สกุล / ชื่อเล่น"
                    value={searchIssue} onChange={e => setSearchIssue(e.target.value)} />
                  <select className={`input ${issueDayFilter ? '!border-blue-400 !bg-blue-50' : ''}`}
                    value={issueDayFilter} onChange={e => setIssueDayFilter(e.target.value)}>
                    <option value="">📅 วันที่เบิก — ทุกวัน</option>
                    {issueDays.map(([d, n]) => <option key={d} value={d}>เบิกเมื่อ {fmtDate(d)} ({n} ใบ)</option>)}
                  </select>
                </div>
                {issueDayFilter && (
                  <p className="text-xs text-blue-600 mt-1 flex items-center gap-2">
                    แสดงเฉพาะใบเบิกวันที่ {fmtDate(issueDayFilter)}
                    <button type="button" className="underline text-gray-500 hover:text-gray-700" onClick={() => setIssueDayFilter('')}>ล้าง</button>
                  </p>
                )}
                <div className="border rounded-lg mt-1 max-h-44 overflow-y-auto">
                  {filtered.length === 0 && (
                    <div className="px-3 py-5 text-center text-gray-400 text-sm">
                      {allOpenIssues.length === 0 ? 'ไม่มีใบเบิกที่ค้างอยู่' : 'เลือกครบแล้ว หรือไม่พบที่ค้นหา'}
                    </div>
                  )}
                  {filtered.map((i: any) => {
                    const rem = remainOf(i);
                    const overdue = i.due_date && i.due_date < new Date().toISOString().split('T')[0];
                    return (
                      <button key={i.id} type="button" onClick={() => addIssue(i)}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 border-b last:border-b-0 flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-mono text-blue-600 text-xs">{i.code}</span>{' '}
                          <span className="font-medium">{i.member_name}</span>
                          {i.member_nickname && <span className="text-gray-400">{' '}({i.member_nickname})</span>}
                          <span className="text-gray-500 block text-xs inline-flex items-center gap-1">{i.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: i.color }} />}{i.product_name}</span>
                          {i.issued_at && <span className="text-gray-400 block text-[11px]">📅 เบิกเมื่อ {fmtDate(i.issued_at)}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="text-amber-600 font-medium text-sm">เหลือ {rem}</span>
                          <span className="text-gray-400 text-xs block">{i.unit}{overdue && ' ⚠️เกินกำหนด'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected issue lines */}
              {lines.map((l: any) => {
                const rem = remainOf(l.issue);
                const total = lineTotal(l);
                return (
                  <div key={l.issue.id} className="border border-blue-200 bg-blue-50/50 rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <span className="font-mono text-blue-600 text-xs">{l.issue.code}</span>{' '}
                        <span className="font-medium">{l.issue.member_name}</span>
                        <span className="text-gray-500 block text-xs inline-flex items-center gap-1">{l.issue.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: l.issue.color }} />}{l.issue.product_name} · คงเหลือ <strong className="text-amber-600">{rem}</strong> {l.issue.unit}</span>
                        {l.issue.issued_at && <span className="text-gray-400 block text-[11px]">📅 เบิกเมื่อ {fmtDate(l.issue.issued_at)}</span>}
                      </div>
                      <button type="button" onClick={() => removeIssue(l.issue.id)} className="shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                    {!l.hasDefect ? (
                      <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                        <span className="text-sm text-green-700">✅ คืนครบ <strong>{rem}</strong> {l.issue.unit} (ไม่มีงานเสีย)</span>
                        <button type="button" onClick={() => toggleDefect(l.issue, true)}
                          className="shrink-0 text-xs font-medium text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg">
                          + มีงานเสีย/เศษ
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-end">
                          <button type="button" onClick={() => toggleDefect(l.issue, false)} className="text-xs text-green-600 hover:underline">↩ คืนครบ ไม่มีงานเสีย</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500">งานดี *</label>
                            <input type="number" step="0.01" min="0" className="input !min-h-[40px] !py-1.5" value={l.good_qty} onChange={e => updateLine(l.issue.id, 'good_qty', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">เศษคืน</label>
                            <input type="number" step="0.01" min="0" className="input !min-h-[40px] !py-1.5" value={l.waste_qty} onChange={e => updateLine(l.issue.id, 'waste_qty', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-xs text-rose-600">เสีย — จากการตัด (หักเงิน)</label>
                            <input type="number" step="0.01" min="0" className="input !min-h-[40px] !py-1.5" value={l.ng_cut} onChange={e => updateLine(l.issue.id, 'ng_cut', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-xs text-amber-600">เสีย — จากโรงงาน (จ่ายปกติ)</label>
                            <input type="number" step="0.01" min="0" className="input !min-h-[40px] !py-1.5" value={l.ng_factory} onChange={e => updateLine(l.issue.id, 'ng_factory', e.target.value)} />
                          </div>
                        </div>
                        <p className={`text-xs ${total > rem + 0.001 ? 'text-red-500' : 'text-gray-500'}`}>
                          รวม {total} / คงเหลือ {rem} {l.issue.unit}
                          {total > rem + 0.001 && ' ⚠️ เกินจำนวนคงเหลือ'}
                          {total > 0 && total >= rem && total <= rem + 0.001 && ' ✅ ใบเบิกจะปิดอัตโนมัติ'}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ผู้ตรวจรับ</label>
                  <input className="input" {...register('inspector')} />
                </div>
                <div>
                  <label className="label">หมายเหตุ</label>
                  <input className="input" {...register('notes')} />
                </div>
              </div>
              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={closeModal}>ยกเลิก</button>
                <button type="submit" className="btn-primary" disabled={saving || lines.length === 0}>
                  {saving ? 'กำลังบันทึก...' : `บันทึกการคืน (${lines.length} ใบ)`}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {editingReturn && (
        <EditReturnModal
          ret={editingReturn}
          onClose={() => setEditingReturn(null)}
          onSaved={refetchAll}
        />
      )}

      {deletingReturn && (
        <DeleteReturnDialog
          ret={deletingReturn}
          onClose={() => setDeletingReturn(null)}
          onDeleted={refetchAll}
        />
      )}
    </div>
  );
}
