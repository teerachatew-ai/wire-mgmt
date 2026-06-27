import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { receiveApi, productApi, ocrApi } from '../api';
import { colorDot } from '../colorDot';
import { matchProduct } from '../matchProduct';
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

export default function Receives() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const { data: receives = [], isLoading } = useQuery({ queryKey: ['receives'], queryFn: () => receiveApi.list() });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });

  const { register, handleSubmit, reset, setValue } = useForm<any>({
    defaultValues: { received_at: new Date().toISOString().split('T')[0] }
  });

  const [ocrState, setOcrState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [ocrMsg, setOcrMsg] = useState('');
  const [editing, setEditing] = useState<any>(null);

  const handleOcr = async (files: File[]) => {
    setOcrState('loading'); setOcrMsg('');
    try {
      const { extracted } = await ocrApi.readShipment(files);
      if (extracted.shipped_at) setValue('received_at', extracted.shipped_at);
      if (extracted.po_number) setValue('factory_ref', extracted.po_number);
      const active = (products as any[]).filter((p: any) => p.active);
      const newLines: { product_id: string; quantity: string }[] = [];
      const unmatched: string[] = [];
      for (const it of (extracted.items || [])) {
        const p = matchProduct(active, it, extracted.po_number);
        if (p) newLines.push({ product_id: String(p.id), quantity: String(it.quantity ?? '') });
        else unmatched.push(`${it.name}=${it.quantity}`);
      }
      if (newLines.length) setLines(newLines);
      setOcrState('done');
      setOcrMsg(
        `อ่านสำเร็จ — เพิ่ม ${newLines.length} รายการ` +
        (unmatched.length ? ` · ไม่พบสินค้า: ${unmatched.join(', ')}` : '') +
        ' (ตรวจทานก่อนบันทึก)'
      );
    } catch (e: any) {
      setOcrState('error');
      setOcrMsg(e.response?.data?.error || 'อ่านไม่สำเร็จ');
    }
  };

  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([{ product_id: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);
  const addLine = () => setLines(l => [...l, { product_id: '', quantity: '' }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, val: string) =>
    setLines(l => l.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const closeModal = () => { setShowModal(false); setError(''); reset(); setLines([{ product_id: '', quantity: '' }]); setOcrState('idle'); setOcrMsg(''); };

  const submit = handleSubmit(async (shared: any) => {
    const valid = lines.filter(l => l.product_id && l.quantity);
    if (valid.length === 0) { setError('กรุณาเลือกสินค้าและจำนวนอย่างน้อย 1 รายการ'); return; }
    setSaving(true); setError('');
    try {
      for (const l of valid) {
        await receiveApi.create({
          received_at: shared.received_at, product_id: l.product_id, quantity: l.quantity,
          factory_ref: shared.factory_ref, notes: shared.notes,
        });
      }
      qc.invalidateQueries({ queryKey: ['receives'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      closeModal();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  });

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
        <button className="btn-primary btn-sm flex items-center gap-2" onClick={() => setShowModal(true)}>
          <Plus size={16} /> บันทึกรับของ
        </button>
      </div>

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
                <td className="px-4 py-3 text-gray-600">{r.received_at}</td>
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
        <Modal title="บันทึกรับของจากโรงงาน" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-3">
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

            <div>
              <label className="label">วันที่รับ *</label>
              <input type="date" className="input" {...register('received_at', { required: true })} />
            </div>

            {/* Multi-product lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">สินค้าที่รับ *</label>
                <button type="button" onClick={addLine}
                  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50">
                  <Plus size={16} /> เพิ่มสินค้า
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex gap-2 items-start p-3 bg-gray-50 rounded-xl">
                    <div className="flex-1 min-w-0 space-y-2">
                      <select className="input" value={line.product_id}
                        onChange={e => updateLine(i, 'product_id', e.target.value)}>
                        <option value="">-- เลือกสินค้า --</option>
                        {(products as any[]).filter((p: any) => p.active).map((p: any) => (
                          <option key={p.id} value={p.id}>{colorDot(p.color)}{p.project ? `${p.project} · ` : ''}{p.name}</option>
                        ))}
                      </select>
                      <input type="number" step="0.01" min="0.01" className="input" placeholder="จำนวน"
                        value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} />
                    </div>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)}
                        className="shrink-0 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
              <button type="button" className="btn-secondary" onClick={closeModal}>ยกเลิก</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'กำลังบันทึก...' : `บันทึก (${lines.filter(l => l.product_id && l.quantity).length} รายการ)`}
              </button>
            </div>
          </form>
        </Modal>
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
