import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { reportApi, managerApi } from '../api';
import { Building2, Users, Plus, Edit2, Trash2, X, Loader2 } from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [groupPct, setGroupPct] = useState('');
  const [adminCostPct, setAdminCostPct] = useState('');
  const [taxPct, setTaxPct] = useState('3');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const { data: managers = [], isLoading } = useQuery({ queryKey: ['managers'], queryFn: managerApi.list });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: reportApi.getSettings });

  useEffect(() => {
    if (settings && !settingsLoaded) {
      setGroupPct((settings as any).group_deduction_percent || '0');
      setAdminCostPct((settings as any).admin_cost_percent || '0');
      setTaxPct((settings as any).withholding_tax_percent || '3');
      setSettingsLoaded(true);
    }
  }, [settings, settingsLoaded]);

  const deleteMgr = useMutation({
    mutationFn: (id: number) => managerApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managers'] }),
  });

  const saveGroupPct = async () => {
    setSavingSettings(true);
    try {
      await reportApi.saveSettings({
        group_deduction_percent: groupPct,
        admin_cost_percent: adminCostPct,
        withholding_tax_percent: taxPct,
      });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['income-chart'] });
    } finally { setSavingSettings(false); }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-800">การหักเข้ากองกลาง</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">ภาษีหัก ณ ที่จ่าย (%)</label>
            <div className="relative">
              <input type="number" step="0.1" min="0" max="100" className="input pr-8" value={taxPct} onChange={e => setTaxPct(e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">ปกติ 3% ตามกฎหมายไทย</p>
          </div>
          <div>
            <label className="label">ค่าบริหารจัดการ (%)</label>
            <div className="relative">
              <input type="number" step="0.1" min="0" max="100" className="input pr-8" value={adminCostPct} onChange={e => setAdminCostPct(e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">ค่าใช้จ่ายในการดำเนินงาน</p>
          </div>
          <div>
            <label className="label">กำไรสุทธิ / กองสะสม (%)</label>
            <div className="relative">
              <input type="number" step="0.1" min="0" max="100" className="input pr-8" value={groupPct} onChange={e => setGroupPct(e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">ระบุ 0 หากไม่มีการสะสม</p>
          </div>
        </div>
        <div className="mt-3 p-3 bg-indigo-50 rounded-lg text-xs text-indigo-700">
          💡 สูตร: รายได้รวม → หักภาษี {taxPct}% → หักค่าบริหาร {adminCostPct}% → หักค่าตอบแทนผู้บริหาร → หักกองสะสม {groupPct}% = <strong>ค่าตัดสมาชิก (สุทธิ)</strong>
        </div>
        <button className="btn-primary mt-3" onClick={saveGroupPct} disabled={savingSettings}>
          {savingSettings ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </button>
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
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b">
              <tr className="text-left text-xs text-gray-500">
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
                <tr key={mg.id} className="border-b border-gray-50 hover:bg-gray-50">
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
