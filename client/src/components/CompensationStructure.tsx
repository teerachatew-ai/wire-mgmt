import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { reportApi, managerApi, expenseApi } from '../api';
import { Building2, Users, Plus, Edit2, Trash2, X, Loader2, Check, Pause, Play } from 'lucide-react';
import BulkActionBar from './BulkActionBar';
import { useBulkSelect, bulkDelete, bulkDeleteSummary } from '../utils/bulkSelect';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── ค่าใช้จ่ายประจำ — ตั้งครั้งเดียว หักอัตโนมัติทุกเดือนในช่วงที่กำหนด ──
   แต่ละรายการเลือกได้ว่าเป็น "บาท/เดือน" หรือ "% ของรายได้" (รายได้หลังหักงาน NG ของเดือนนั้น)
   ระบบนำไปหักในภาพรวม (กำไรสุทธิ) งบกำไรขาดทุน งบการเงิน และแผนส่งงาน — ฝั่ง server: recurringExpenseLines */
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ymLabel = (ym?: string | null) => { if (!ym) return ''; const [y, m] = ym.split('-').map(Number); return `${TH_M[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`; };
const thisYM = () => new Intl.DateTimeFormat('en-CA').format(new Date()).slice(0, 7);
const EMPTY_RE = () => ({ name: '', kind: 'fixed', value: '', start_month: thisYM(), end_month: '' });

function RecurringExpenses() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: ['recurring-expenses'], queryFn: expenseApi.recurringList });
  const [form, setForm] = useState<any>(EMPTY_RE());
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['recurring-expenses'] });
    for (const k of ['performance', 'dashboard', 'reports']) qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({
    mutationFn: (v: any) => v.id ? expenseApi.recurringUpdate(v.id, v) : expenseApi.recurringCreate(v),
    onSuccess: (_r, v: any) => { refresh(); setErr(''); if (v.id) { setEditId(null); setEdit(null); } else setForm(EMPTY_RE()); },
    onError: (e: any) => setErr(e?.response?.data?.error || 'บันทึกไม่สำเร็จ'),
  });
  const del = useMutation({ mutationFn: (id: number) => expenseApi.recurringDelete(id), onSuccess: refresh });

  const kindText = (it: any) => it.kind === 'percent' ? `${Number(it.value)}% ของรายได้` : `฿${fmt(it.value)} / เดือน`;
  const range = (it: any) => it.end_month ? `${ymLabel(it.start_month)} – ${ymLabel(it.end_month)}` : `ตั้งแต่ ${ymLabel(it.start_month)}`;
  // ฟอร์มเพิ่ม/แก้ไข — ชื่อเต็มบรรทัด แล้วตามด้วย ประเภท / จำนวน / ช่วงเดือน (การ์ดตั้งค่าแคบ วางเรียงแถวเดียวไม่พอ)
  const formBox = (v: any, set: (f: string, x: any) => void, actions: React.ReactNode) => (
    <div className="p-3 space-y-2">
      <input className="input !min-h-[38px] !py-1.5" placeholder="ชื่อรายการ เช่น ค่าเช่าที่, ค่าบริหารจัดการ" aria-label="ชื่อรายการ"
        value={v.name} onChange={e => set('name', e.target.value)} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-[11px] text-gray-500">ประเภท
          <select className="input !min-h-[38px] !py-1.5 mt-0.5" value={v.kind} onChange={e => set('kind', e.target.value)}>
            <option value="fixed">บาท / เดือน</option>
            <option value="percent">% ของรายได้</option>
          </select>
        </label>
        <label className="text-[11px] text-gray-500">จำนวน
          <span className="relative block mt-0.5">
            <input type="number" min="0" step={v.kind === 'percent' ? '0.1' : '1'} className="input !min-h-[38px] !py-1.5 pr-8 text-right" placeholder="0"
              value={v.value} onChange={e => set('value', e.target.value)} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{v.kind === 'percent' ? '%' : '฿'}</span>
          </span>
        </label>
        <label className="text-[11px] text-gray-500">เริ่มเดือน
          <input type="month" className="input !min-h-[38px] !py-1.5 mt-0.5" value={v.start_month} onChange={e => set('start_month', e.target.value)} />
        </label>
        <label className="text-[11px] text-gray-500">ถึงเดือน <span className="text-gray-400">(ว่าง = ไม่มีกำหนด)</span>
          <input type="month" className="input !min-h-[38px] !py-1.5 mt-0.5" value={v.end_month || ''} onChange={e => set('end_month', e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2">{actions}</div>
    </div>
  );

  return (
    <div className="mt-5 pt-4 border-t">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-800 text-sm">รายการค่าใช้จ่ายประจำ</h3>
        <span className="text-[11px] text-gray-400">หักอัตโนมัติทุกเดือนในช่วงที่กำหนด</span>
      </div>
      {isLoading ? <div className="py-4 text-center text-gray-400"><Loader2 size={16} className="animate-spin mx-auto" /></div> : (
        <div className="divide-y border rounded-xl overflow-hidden">
          {(items as any[]).length === 0 && <p className="px-3 py-3 text-sm text-gray-400">ยังไม่มีรายการ — เพิ่มด้านล่าง</p>}
          {(items as any[]).map((it: any) => editId === it.id ? (
            <div key={it.id} className="bg-blue-50/50">
              {formBox(edit, (f, x) => setEdit((e: any) => ({ ...e, [f]: x })), <>
                <button type="button" className="btn-secondary !min-h-[36px] !py-1.5" onClick={() => { setEditId(null); setEdit(null); }}>ยกเลิก</button>
                <button type="button" className="btn-primary !min-h-[36px] !py-1.5 flex items-center gap-1" disabled={save.isPending}
                  onClick={() => save.mutate({ ...edit, id: it.id })}><Check size={14} /> บันทึก</button>
              </>)}
            </div>
          ) : (
            <div key={it.id} className={`flex items-center gap-3 px-3 py-2.5 ${it.active ? '' : 'opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 text-sm">{it.name}</span>
                  <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${it.kind === 'percent' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'}`}>
                    {it.kind === 'percent' ? '% ของรายได้' : 'บาท / เดือน'}
                  </span>
                  {!it.active && <span className="text-[10px] text-gray-500 border rounded px-1">พักไว้</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{range(it)}</div>
              </div>
              <span className="text-sm font-semibold tabular-nums text-gray-800 whitespace-nowrap">{kindText(it)}</span>
              <div className="flex gap-0.5 shrink-0">
                <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50" aria-label={it.active ? 'พักไว้' : 'ใช้งาน'}
                  title={it.active ? 'พักไว้ (ไม่หักชั่วคราว)' : 'กลับมาใช้งาน'} onClick={() => save.mutate({ id: it.id, active: !it.active })}>
                  {it.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="แก้ไข" aria-label="แก้ไข"
                  onClick={() => { setEditId(it.id); setEdit({ name: it.name, kind: it.kind, value: String(it.value), start_month: it.start_month, end_month: it.end_month || '' }); }}>
                  <Edit2 size={14} />
                </button>
                <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="ลบ" aria-label="ลบ"
                  onClick={() => { if (confirm(`ลบค่าใช้จ่ายประจำ "${it.name}"? (ยอดของทุกเดือนที่ผ่านมาจะไม่ถูกหักอีก)`)) del.mutate(it.id); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {/* เพิ่มรายการใหม่ */}
          <div className="bg-gray-50/70">
            {formBox(form, (f, x) => setForm((v: any) => ({ ...v, [f]: x })),
              <button type="button" className="btn-primary !min-h-[36px] !py-1.5 flex items-center gap-1"
                disabled={save.isPending || !form.name.trim() || form.value === ''} onClick={() => save.mutate(form)}>
                <Plus size={14} /> เพิ่มค่าใช้จ่ายประจำ
              </button>)}
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
        "% ของรายได้" คิดจากรายได้ของเดือนนั้นหลังหักงาน NG · "ถึงเดือน" เว้นว่าง = หักทุกเดือนไปเรื่อยๆ · ปุ่ม ⏸ พักไว้ชั่วคราวโดยไม่ต้องลบ
        · ค่าใช้จ่ายที่จ่ายครั้งเดียวในบางเดือน ใส่ที่ "ค่าใช้จ่ายบริหารจัดการ" ในหน้าภาพรวมเหมือนเดิม
      </p>
    </div>
  );
}

/* ── Manager Form Modal ── */
function ManagerModal({ manager, onClose }: { manager: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch } = useForm<any>({
    defaultValues: manager || { name: '', role: '', compensation_type: 'fixed', amount: 0, sort_order: 0 }
  });
  const compType = watch('compensation_type');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const onSubmit = async (vals: any) => {
    setLoading(true); setErr('');
    try {
      if (manager) await managerApi.update(manager.id, vals);
      else await managerApi.create(vals);
      qc.invalidateQueries({ queryKey: ['managers'] });
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.error ?? 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800">{manager ? 'แก้ไขผู้บริหาร' : 'เพิ่มผู้บริหาร'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">ชื่อ *</label>
              <input className="input" {...register('name', { required: true })} placeholder="ชื่อ-สกุล" />
            </div>
            <div className="col-span-2">
              <label className="label">ตำแหน่ง / บทบาท</label>
              <input className="input" {...register('role')} placeholder="ประธาน, รองประธาน, เหรัญญิก..." />
            </div>
            <div>
              <label className="label">ลำดับ</label>
              <input type="number" className="input" {...register('sort_order', { valueAsNumber: true })} placeholder="1, 2, 3..." />
            </div>
            <div>
              <label className="label">รูปแบบค่าตอบแทน</label>
              <select className="input" {...register('compensation_type')}>
                <option value="fixed">ตายตัว (บาท/เดือน)</option>
                <option value="percent">% ของรายได้รวม</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">{compType === 'percent' ? 'เปอร์เซ็นต์ (%)' : 'จำนวนเงิน (บาท)'}</label>
              <input type="number" step="0.01" className="input" {...register('amount', { valueAsNumber: true })} placeholder={compType === 'percent' ? 'เช่น 5 (= 5%)' : 'เช่น 3000'} />
            </div>
          </div>
          {err && <p className="text-red-500 text-sm">{err}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'กำลังบันทึก...' : manager ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Compensation structure (โครงสร้างค่าตอบแทน) ── */
export default function CompensationStructure() {
  const qc = useQueryClient();
  const [editMgr, setEditMgr] = useState<any>(undefined);
  const [savingSettings, setSavingSettings] = useState(false);
  const [taxPct, setTaxPct] = useState('3');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const { data: managers = [], isLoading } = useQuery({ queryKey: ['managers'], queryFn: managerApi.list });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: reportApi.getSettings });

  useEffect(() => {
    if (settings && !settingsLoaded) {
      setTaxPct((settings as any).withholding_tax_percent || '3');
      setSettingsLoaded(true);
    }
  }, [settings, settingsLoaded]);

  const deleteMgr = useMutation({
    mutationFn: (id: number) => managerApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managers'] }),
  });

  const { selected, toggle, toggleAll, clear } = useBulkSelect();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || !confirm(`ลบผู้บริหารที่เลือกไว้ ${ids.length} คน?`)) return;
    setBulkDeleting(true);
    const result = await bulkDelete(ids, (id) => managerApi.delete(id));
    setBulkDeleting(false);
    clear();
    qc.invalidateQueries({ queryKey: ['managers'] });
    alert(bulkDeleteSummary(result));
  };

  const saveGroupPct = async () => {
    setSavingSettings(true);
    try {
      await reportApi.saveSettings({ withholding_tax_percent: taxPct });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['income-chart'] });
    } finally { setSavingSettings(false); }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-800">ค่าใช้จ่ายประจำ</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">หักจากรายได้ทุกเดือนก่อนเป็นกำไรสุทธิ — ภาษีหัก ณ ที่จ่าย และรายการค่าใช้จ่ายประจำที่เพิ่มเอง</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="label">ภาษีหัก ณ ที่จ่าย (%)</label>
            <div className="relative">
              <input type="number" step="0.1" min="0" max="100" className="input pr-8" value={taxPct} onChange={e => setTaxPct(e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
          </div>
          <button className="btn-primary" onClick={saveGroupPct} disabled={savingSettings}>
            {savingSettings ? 'กำลังบันทึก...' : 'บันทึกภาษี'}
          </button>
          <p className="text-xs text-gray-400 pb-2.5">ปกติ 3% ตามกฎหมายไทย</p>
        </div>
        <RecurringExpenses />
        <div className="mt-4 p-3 bg-indigo-50 rounded-lg text-xs text-indigo-700">
          💡 สูตร: รายได้ (หลังหักงาน NG) → หักภาษี {taxPct}% → หักค่าแรงสมาชิก → หักค่าตอบแทนผู้บริหาร → หักค่าใช้จ่ายประจำ + ค่าใช้จ่ายบริหารจัดการรายเดือน = <strong>กำไรสุทธิ</strong>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-purple-600" />
            <h2 className="font-semibold text-gray-700 text-sm">ผู้บริหารกลุ่ม</h2>
          </div>
          <button className="btn-primary flex items-center gap-1.5 text-xs py-1.5" onClick={() => setEditMgr(null)}>
            <Plus size={14} /> เพิ่มผู้บริหาร
          </button>
        </div>

        {isLoading && <div className="py-8 text-center text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>}
        {!isLoading && (managers as any[]).length === 0 && (
          <div className="py-10 text-center text-gray-400">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">ยังไม่มีผู้บริหาร — กดปุ่ม "เพิ่มผู้บริหาร" เพื่อตั้งค่า</p>
          </div>
        )}
        {(managers as any[]).length > 0 && (
          <div className="overflow-x-auto">
          <div className="px-4 pt-3"><BulkActionBar count={selected.size} onDelete={handleBulkDelete} onClear={clear} deleting={bulkDeleting} label="คน" /></div>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={(managers as any[]).every((mg: any) => selected.has(mg.id))}
                    onChange={() => toggleAll((managers as any[]).map((mg: any) => mg.id))} />
                </th>
                <th className="px-4 py-3 font-medium">ลำดับ</th>
                <th className="px-4 py-3 font-medium">ชื่อ</th>
                <th className="px-4 py-3 font-medium">ตำแหน่ง</th>
                <th className="px-4 py-3 font-medium">รูปแบบ</th>
                <th className="px-4 py-3 font-medium text-right">อัตรา</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(managers as any[]).map((mg: any, i: number) => (
                <tr key={mg.id} className={`border-b border-gray-50 hover:bg-gray-50 ${selected.has(mg.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(mg.id)} onChange={() => toggle(mg.id)} /></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">คนที่ {i + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{mg.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{mg.role || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${mg.compensation_type === 'percent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {mg.compensation_type === 'percent' ? '% รายได้' : 'ตายตัว'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700">
                    {mg.compensation_type === 'percent' ? `${mg.amount}%` : `${fmt(mg.amount)} บาท`}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${mg.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                      {mg.active ? 'ใช้งาน' : 'ปิด'}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex items-center gap-2">
                    <button className="text-gray-400 hover:text-blue-600" onClick={() => setEditMgr(mg)}><Edit2 size={14} /></button>
                    <button className="text-gray-400 hover:text-red-600" onClick={() => { if (confirm(`ลบ ${mg.name}?`)) deleteMgr.mutate(mg.id); }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card bg-amber-50 border-amber-200 text-sm text-amber-800 space-y-1">
        <p className="font-semibold">💡 วิธีคำนวณ</p>
        <p>รายได้รวม → หัก % กองกลาง → หักค่าตอบแทนผู้บริหาร (รวมทุกคน) = <strong>จ่ายสุทธิให้สมาชิก</strong></p>
        <p className="text-xs">ค่าตอบแทนแบบ % คำนวณจาก "รายได้รวม" ก่อนหักกองกลาง</p>
      </div>

      {editMgr !== undefined && <ManagerModal manager={editMgr} onClose={() => setEditMgr(undefined)} />}
    </div>
  );
}
