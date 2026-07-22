import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { assetApi } from '../api';
import { Boxes, Plus, X, Edit2, Trash2, Coins, Loader2 } from 'lucide-react';
import ExportExcelButton from '../components/ExportExcelButton';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

function AssetForm({ defaultValues, onSubmit, loading }: any) {
  const { register, handleSubmit, watch } = useForm({ defaultValues: { owner_advanced: false, ...defaultValues } });
  const adv = watch('owner_advanced');
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div><label className="label">ชื่อสินทรัพย์ *</label><input className="input" {...register('name', { required: true })} placeholder="เช่น เครื่องตัดสายไฟ, โต๊ะทำงาน" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">ราคาซื้อ (บาท) *</label><input type="number" step="0.01" className="input" {...register('price', { required: true })} /></div>
        <div><label className="label">วันที่ซื้อ</label><input type="date" className="input" {...register('purchase_date')} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer">
        <input type="checkbox" {...register('owner_advanced')} className="w-4 h-4" />
        <span><b>เจ้าของออกเงินให้ก่อน</b> (กลุ่มต้องทยอยคืน)</span>
      </label>
      {adv && <p className="text-xs text-amber-600 -mt-1">ติ๊กไว้ = ติดตามยอดที่กลุ่มทยอยคืนเจ้าของได้</p>}
      <div><label className="label">หมายเหตุ</label><input className="input" {...register('note')} /></div>
      <div className="flex justify-end pt-1">
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </form>
  );
}

function RepaymentModal({ asset, onClose }: any) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ['repay', asset.id], queryFn: () => assetApi.repayments(asset.id) });
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const addMut = useMutation({
    mutationFn: () => assetApi.addRepayment(asset.id, { amount, paid_at: paidAt, note }),
    onSuccess: () => { setAmount(''); setNote(''); qc.invalidateQueries({ queryKey: ['repay', asset.id] }); qc.invalidateQueries({ queryKey: ['assets'] }); },
  });
  const delMut = useMutation({
    mutationFn: (rid: number) => assetApi.deleteRepayment(rid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['repay', asset.id] }); qc.invalidateQueries({ queryKey: ['assets'] }); },
  });
  const totalRepaid = (list as any[]).reduce((s, r) => s + (r.amount || 0), 0);
  const remaining = Math.max(0, (asset.price || 0) - totalRepaid);

  return (
    <Modal title={`การคืนเงิน — ${asset.name}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-gray-50 rounded-lg p-2"><div className="text-xs text-gray-500">ราคาซื้อ</div><div className="font-bold text-gray-800">{fmt(asset.price)}</div></div>
        <div className="bg-green-50 rounded-lg p-2"><div className="text-xs text-gray-500">คืนแล้ว</div><div className="font-bold text-green-700">{fmt(totalRepaid)}</div></div>
        <div className="bg-rose-50 rounded-lg p-2"><div className="text-xs text-gray-500">คงเหลือ</div><div className="font-bold text-rose-600">{fmt(remaining)}</div></div>
      </div>
      <div className="border rounded-lg p-3 bg-gray-50 space-y-2 mb-4">
        <p className="label mb-0">เพิ่มการคืนเงิน</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" step="0.01" className="input text-sm" placeholder="จำนวนเงิน" value={amount} onChange={e => setAmount(e.target.value)} />
          <input type="date" className="input text-sm" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
        </div>
        <input className="input text-sm" placeholder="หมายเหตุ (ไม่บังคับ)" value={note} onChange={e => setNote(e.target.value)} />
        <button className="btn-primary btn-sm w-full flex items-center justify-center gap-2" disabled={addMut.isPending} onClick={() => addMut.mutate()}>
          {addMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} บันทึกการคืน
        </button>
      </div>
      <p className="label">ประวัติการคืน</p>
      {(list as any[]).length === 0 && <p className="text-sm text-gray-400 py-3 text-center">ยังไม่มีการคืนเงิน</p>}
      <div className="space-y-1">
        {(list as any[]).map((r: any) => (
          <div key={r.id} className="flex items-center justify-between text-sm border-b border-gray-50 py-1.5">
            <span className="text-gray-500 text-xs w-24">{r.paid_at || '-'}</span>
            <span className="font-medium text-green-700">{fmt(r.amount)}</span>
            <span className="text-gray-400 text-xs flex-1 px-2 truncate">{r.note || ''}</span>
            <button className="text-gray-300 hover:text-red-500" onClick={() => delMut.mutate(r.id)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function Assets() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [repayAsset, setRepayAsset] = useState<any>(null);

  const { data, isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetApi.list });
  const assets: any[] = data?.assets || [];
  const totals = data?.totals || {};

  const createMut = useMutation({ mutationFn: assetApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setModal(null); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => assetApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setModal(null); } });
  const deleteMut = useMutation({ mutationFn: (id: number) => assetApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }) });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes size={20} className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">สินทรัพย์ / การลงทุน</h1>
        </div>
        <div className="flex items-center gap-2">
          <ExportExcelButton filename="สินทรัพย์และการลงทุน" rows={assets.map(a => ({
            'สินทรัพย์': a.name, 'วันที่ซื้อ': a.purchase_date || '', 'ราคาซื้อ': a.price,
            'เจ้าของออกก่อน': a.owner_advanced ? 'ใช่' : 'ไม่ใช่',
            'คืนแล้ว': a.owner_advanced ? a.repaid : '', 'คงเหลือ': a.owner_advanced ? a.remaining : '',
            'หมายเหตุ': a.note || '',
          }))} />
          <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => { setEditing(null); setModal('add'); }}>
            <Plus size={16} /> เพิ่มสินทรัพย์
          </button>
        </div>
      </div>

      {/* สรุป */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-gray-500">มูลค่าสินทรัพย์รวม</div><div className="text-xl font-bold text-gray-800">{fmt(totals.total_price)}</div></div>
        <div className="card"><div className="text-xs text-gray-500">เจ้าของออกให้ก่อน</div><div className="text-xl font-bold text-amber-600">{fmt(totals.total_advanced)}</div></div>
        <div className="card"><div className="text-xs text-gray-500">คืนเจ้าของแล้ว</div><div className="text-xl font-bold text-green-700">{fmt(totals.total_repaid)}</div></div>
        <div className="card"><div className="text-xs text-gray-500">ค้างคืนเจ้าของ</div><div className="text-xl font-bold text-rose-600">{fmt(totals.total_remaining)}</div></div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">สินทรัพย์</th>
              <th className="px-4 py-3 text-left font-medium">วันที่ซื้อ</th>
              <th className="px-4 py-3 text-right font-medium">ราคาซื้อ</th>
              <th className="px-4 py-3 text-center font-medium">เจ้าของออกก่อน</th>
              <th className="px-4 py-3 text-right font-medium">คืนแล้ว</th>
              <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {!isLoading && assets.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">ยังไม่มีสินทรัพย์ — กด "เพิ่มสินทรัพย์"</td></tr>}
            {assets.map((a: any) => (
              <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{a.name}{a.note && <div className="text-xs text-gray-400 font-normal">{a.note}</div>}</td>
                <td className="px-4 py-3 text-gray-500">{a.purchase_date || '-'}</td>
                <td className="px-4 py-3 text-right font-medium">{fmt(a.price)}</td>
                <td className="px-4 py-3 text-center">{a.owner_advanced ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">ใช่</span> : <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3 text-right text-green-700">{a.owner_advanced ? fmt(a.repaid) : '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-rose-600">{a.owner_advanced ? fmt(a.remaining) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    {a.owner_advanced && (
                      <button className="text-gray-400 hover:text-green-600" title="คืนเงิน/ดูประวัติ" onClick={() => setRepayAsset(a)}><Coins size={15} /></button>
                    )}
                    <button className="text-gray-400 hover:text-blue-600" title="แก้ไข" onClick={() => { setEditing(a); setModal('edit'); }}><Edit2 size={15} /></button>
                    <button className="text-gray-400 hover:text-red-600" title="ลบ" onClick={() => { if (confirm(`ลบสินทรัพย์ "${a.name}"?`)) deleteMut.mutate(a.id); }}><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === 'add' ? 'เพิ่มสินทรัพย์' : 'แก้ไขสินทรัพย์'} onClose={() => setModal(null)}>
          <AssetForm
            defaultValues={editing ? { ...editing, owner_advanced: !!editing.owner_advanced } : {}}
            loading={createMut.isPending || updateMut.isPending}
            onSubmit={(d: any) => { if (modal === 'add') createMut.mutate(d); else updateMut.mutate({ id: editing.id, data: d }); }}
          />
        </Modal>
      )}
      {repayAsset && <RepaymentModal asset={repayAsset} onClose={() => setRepayAsset(null)} />}
    </div>
  );
}
