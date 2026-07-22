import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { receiveApi, productApi, ocrApi } from '../api';
import { colorDot } from '../colorDot';
import { matchProduct } from '../matchProduct';
import DaySummary from '../components/DaySummary';
import ExportExcelButton from '../components/ExportExcelButton';
import { Plus, X, ArrowDownToLine, Trash2, Edit2, ScanLine, Upload, FileText, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

/* ── Edit receive modal (single product) ── */
function EditReceiveModal({ rec, products, onClose, onSaved }: any) {
  const { register, handleSubmit } = useForm<any>({
    defaultValues: {
      received_at: rec.received_at, product_id: rec.product_id, quantity: rec.quantity,
      factory_ref: rec.factory_ref || '', notes: rec.notes || '',
    }
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const onSubmit = async (d: any) => {
    setLoading(true); setError('');
    try { await receiveApi.update(rec.id, d); onSaved(); onClose(); }
    catch (e: any) { setError(e.response?.data?.error || 'เกิดข้อผิดพลาด'); setLoading(false); }
  };
  return (
    <Modal title={`แก้ไขรับของ ${rec.code}`} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className="label">วันที่รับ *</label>
          <input type="date" className="input" {...register('received_at', { required: true })} />
        </div>
        <div>
          <label className="label">สินค้า *</label>
          <select className="input" {...register('product_id', { required: true })}>
            {(products as any[]).map((p: any) => (
              <option key={p.id} value={p.id}>{colorDot(p.color)}{p.project ? `${p.project} · ` : ''}{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">จำนวน *</label>
          <input type="number" step="0.01" min="0.01" className="input" {...register('quantity', { required: true })} />
        </div>
        <div>
          <label className="label">เลขเอกสารโรงงาน</label>
          <input className="input" {...register('factory_ref')} />
        </div>
        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" {...register('notes')} />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Record Receive Modal — สินค้าทุกตัวเรียงลงมาให้กรอกเลย (แบบเดียวกับหน้าส่งของ) ── */
function ReceiveModal({ products, onClose }: { products: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, control, setValue, getValues, watch } = useForm<any>({
    defaultValues: {
      received_at: new Date().toISOString().split('T')[0],
      factory_ref: '', notes: '',
      items: products.map(p => ({ product_id: p.id, product_name: p.name, color: p.color, unit: p.unit, quantity: '' })),
    }
  });
  const { fields } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ocrState, setOcrState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [ocrMsg, setOcrMsg] = useState('');

  const handleOcr = async (files: File[]) => {
    setOcrState('loading'); setOcrMsg('');
    try {
      const { extracted } = await ocrApi.readShipment(files);
      if (extracted.shipped_at) setValue('received_at', extracted.shipped_at);
      if (extracted.po_number) setValue('factory_ref', extracted.po_number);
      const current = getValues('items') as any[];
      const unmatched: string[] = [];
      let matched = 0;
      for (const it of (extracted.items || [])) {
        const prod = matchProduct(products, it, extracted.po_number);
        const idx = prod ? current.findIndex((f: any) => String(f.product_id) === String(prod.id)) : -1;
        if (idx >= 0) { setValue(`items.${idx}.quantity`, Number(it.quantity) || 0); matched++; }
        else unmatched.push(`${it.name}=${it.quantity}`);
      }
      setOcrState('done');
      setOcrMsg(
        `อ่านสำเร็จ — เติมจำนวนให้ ${matched} รายการ` +
        (unmatched.length ? ` · ไม่พบสินค้า: ${unmatched.join(', ')}` : '') +
        ' (ตรวจทานก่อนบันทึก)'
      );
    } catch (e: any) {
      setOcrState('error');
      setOcrMsg(e.response?.data?.error || 'อ่านไม่สำเร็จ');
    }
  };

  const onSubmit = async (vals: any) => {
    const valid = (vals.items || []).filter((it: any) => it.quantity !== '' && Number(it.quantity) > 0);
    if (valid.length === 0) { setError('กรุณากรอกจำนวนอย่างน้อย 1 รายการ'); return; }
    setSaving(true); setError('');
    try {
      for (const it of valid) {
        await receiveApi.create({
          received_at: vals.received_at, product_id: it.product_id, quantity: it.quantity,
          factory_ref: vals.factory_ref, notes: vals.notes,
        });
      }
      qc.invalidateQueries({ queryKey: ['receives'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  };

  const filledCount = (watchedItems || []).filter((it: any) => it?.quantity !== '' && Number(it?.quantity) > 0).length;

  return (
    <Modal title="บันทึกรับของจากโรงงาน" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {/* OCR — อ่านจากใบส่ง/ใบรับของ */}
        <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-3">
          <div className="flex items-center gap-2 text-indigo-700 mb-2">
            <ScanLine size={16} />
            <span className="text-sm font-semibold">อ่านจากใบส่งของ (รูป / PDF)</span>
            <span className="ml-auto text-xs text-indigo-500">AI อ่านจำนวนให้อัตโนมัติ</span>
          </div>
          {ocrState !== 'loading' ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 rounded-lg cursor-pointer">
                <Upload size={15} /> แนบรูป/PDF (หลายไฟล์ได้)
                <input type="file" accept="image/*,application/pdf,.pdf" multiple className="hidden"
                  onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleOcr(fs); e.target.value = ''; }} />
              </label>
              <label className="inline-flex items-center gap-1.5 bg-white border border-indigo-300 text-indigo-700 text-sm font-medium px-3 py-2 rounded-lg cursor-pointer">
                <FileText size={15} /> ถ่ายรูป
                <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleOcr(fs); e.target.value = ''; }} />
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-indigo-700 text-sm"><Loader2 size={16} className="animate-spin" /> AI กำลังอ่านเอกสาร...</div>
          )}
          {ocrMsg && (
            <p className={`text-xs mt-2 flex items-start gap-1 ${ocrState === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {ocrState === 'error' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle size={13} className="mt-0.5 shrink-0" />}
              <span>{ocrMsg}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">วันที่รับ *</label>
            <input type="date" className="input" {...register('received_at', { required: true })} />
          </div>
          <div>
            <label className="label">เลขเอกสารโรงงาน</label>
            <input className="input" {...register('factory_ref')} />
          </div>
        </div>

        {/* รายการสินค้า — เรียงทุกตัวลงมาให้กรอกจำนวนได้เลย ไม่ต้องเลือกจาก dropdown */}
        <div>
          <label className="label mb-2 block">สินค้าที่รับ (กรอกเฉพาะที่มี)</label>
          <div className="space-y-2">
            {fields.map((f: any, i: number) => (
              <div key={f.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 inline-flex items-center gap-2">
                  {f.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: f.color }} />}
                  <span className="truncate">{f.product_name}</span>
                </span>
                <input type="number" step="0.01" min="0" className="input w-32 shrink-0 text-right" placeholder="0"
                  {...register(`items.${i}.quantity`)} />
                <span className="text-xs text-gray-400 w-10 shrink-0">{f.unit}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" {...register('notes')} />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'กำลังบันทึก...' : `บันทึก (${filledCount} รายการ)`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Receives() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const [dayFilter, setDayFilter] = useState('');
  const [search, setSearch] = useState('');
  const { data: receivesRaw = [], isLoading } = useQuery({ queryKey: ['receives', dayFilter], queryFn: () => receiveApi.list({ date: dayFilter || undefined }) });
  // ค้นหา: เลขที่ใบรับ / เลขอ้างอิงโรงงาน / สินค้า
  const rq = search.trim().toLowerCase();
  const receives = (receivesRaw as any[]).filter((r: any) => !rq
    || String(r.code || '').toLowerCase().includes(rq)
    || String(r.factory_ref || '').toLowerCase().includes(rq)
    || String(r.product_name || '').toLowerCase().includes(rq));
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });

  const [editing, setEditing] = useState<any>(null);
  const activeProducts = (products as any[]).filter((p: any) => p.active);

  const deleteMut = useMutation({
    mutationFn: (id: number) => receiveApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receives'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownToLine size={20} className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">รับของจากโรงงาน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="input w-52 text-sm" placeholder="🔍 เลขใบรับ / Ref / สินค้า" value={search} onChange={e => setSearch(e.target.value)} />
          <input type="date" className="input w-40 text-sm" value={dayFilter} onChange={e => setDayFilter(e.target.value)} title="ดูเฉพาะวันที่รับ" />
          {dayFilter && <button className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={() => setDayFilter('')}>ล้างวันที่</button>}
          <ExportExcelButton filename="รับของจากโรงงาน" rows={(receives as any[]).map(r => ({
            'เลขที่รับ': r.code, 'วันที่': r.received_at, 'สินค้า': r.product_name, 'จำนวน': r.quantity, 'หน่วย': r.unit,
            'เลขเอกสารโรงงาน': r.factory_ref || '', 'หมายเหตุ': r.notes || '', 'ผู้บันทึก': r.created_by || '',
          }))} />
          <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => setShowModal(true)}>
            <Plus size={16} /> บันทึกรับของ
          </button>
        </div>
      </div>

      <DaySummary
        groups={Object.values((receives as any[]).reduce((a: any, r: any) => {
          const k = r.product_name; (a[k] ??= { name: k, unit: r.unit, color: r.color, qty: 0 }).qty += Number(r.quantity) || 0; return a;
        }, {})) as any[]}
        note={dayFilter || 'ทั้งหมด'} unitLabel="รับเข้า" />

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">เลขที่รับ</th>
              <th className="px-4 py-3 font-medium">วันที่</th>
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 font-medium text-right">จำนวน</th>
              <th className="px-4 py-3 font-medium">เลขเอกสารโรงงาน</th>
              <th className="px-4 py-3 font-medium">หมายเหตุ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {receives.map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{r.code}</td>
                <td className="px-4 py-3 text-gray-600">{r.received_at}{r.created_by && <div className="text-xs text-gray-400">โดย {r.created_by}</div>}</td>
                <td className="px-4 py-3 font-medium text-gray-800">
                  <span className="inline-flex items-center gap-2">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    {r.product_name}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium">{r.quantity.toLocaleString()} {r.unit}</td>
                <td className="px-4 py-3 text-gray-500">{r.factory_ref || '-'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{r.notes || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button className="text-gray-400 hover:text-amber-600" title="แก้ไข" onClick={() => setEditing(r)}>
                      <Edit2 size={15} />
                    </button>
                    <button className="text-gray-400 hover:text-red-600" title="ลบ"
                      onClick={() => { if (confirm(`ลบรายการรับของ ${r.code}?`)) deleteMut.mutate(r.id); }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && receives.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">ยังไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ReceiveModal products={activeProducts} onClose={() => setShowModal(false)} />
      )}

      {editing && (
        <EditReceiveModal
          rec={editing}
          products={(products as any[]).filter((p: any) => p.active || p.id === editing.product_id)}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['receives'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }}
        />
      )}
    </div>
  );
}
