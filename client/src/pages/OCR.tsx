import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ocrApi, issueApi, returnApi, memberApi, productApi } from '../api';
import { ScanLine, Upload, CheckCircle, AlertCircle, Eye, FileText } from 'lucide-react';
import MemberSelect from '../components/MemberSelect';
import { colorDot } from '../colorDot';

export default function OCR() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; isPdf: boolean } | null>(null);
  const [extracted, setExtracted] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState('');

  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: openIssues = [] } = useQuery({ queryKey: ['issues-open-ocr'], queryFn: () => issueApi.list({ status: 'pending' }) });
  const { data: partialIssues = [] } = useQuery({ queryKey: ['issues-partial-ocr'], queryFn: () => issueApi.list({ status: 'partial' }) });
  const allOpenIssues = [...(openIssues as any[]), ...(partialIssues as any[])];

  const { register, handleSubmit, reset, setValue, watch } = useForm();
  register('member_id');

  const ocrMut = useMutation({
    mutationFn: ocrApi.readForm,
    onSuccess: (data: any) => {
      const ex = data.extracted;
      setExtracted(ex);
      // pre-fill form
      if (ex.date) setValue('date', ex.date);
      if (ex.quantity) setValue('quantity', ex.quantity);
      if (ex.good_qty) setValue('good_qty', ex.good_qty);
      if (ex.defect_qty) setValue('defect_qty', ex.defect_qty);
      if (ex.waste_qty) setValue('waste_qty', ex.waste_qty);
      if (ex.notes) setValue('notes', ex.notes);
      // try to match member
      if (ex.member_code) {
        const m = (members as any[]).find(m => m.code === ex.member_code);
        if (m) setValue('member_id', m.id);
      }
      // try to match product
      if (ex.product_code) {
        const p = (products as any[]).find(p => p.code === ex.product_code);
        if (p) setValue('product_id', p.id);
      }
      // try to match issue
      if (ex.issue_code) {
        const issue = allOpenIssues.find((i: any) => i.code === ex.issue_code);
        if (issue) setSelectedIssueId(String(issue.id));
      }
      setSaved(false); setSaveError('');
    }
  });

  const onFile = (file: File) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    setPreview(URL.createObjectURL(file));
    setFileInfo({ name: file.name, isPdf });
    setExtracted(null); setSaved(false); setSaveError(''); reset();
    ocrMut.mutate(file);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); };
  const formType = extracted?.form_type;

  const onSave = handleSubmit(async (data) => {
    setSaveError('');
    try {
      if (formType === 'issue') {
        await issueApi.create({ issued_at: data.date, member_id: data.member_id, product_id: data.product_id, quantity: data.quantity, notes: data.notes });
      } else {
        const issueId = selectedIssueId || data.issue_id;
        if (!issueId) return setSaveError('กรุณาเลือกใบเบิก');
        await returnApi.create({ issue_id: issueId, returned_at: data.date, good_qty: data.good_qty, defect_qty: data.defect_qty || 0, waste_qty: data.waste_qty || 0, inspector: data.inspector, notes: data.notes });
      }
      qc.invalidateQueries({ queryKey: ['issues'] }); qc.invalidateQueries({ queryKey: ['returns'] }); qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSaved(true);
    } catch (e: any) { setSaveError(e.response?.data?.error || 'เกิดข้อผิดพลาด'); }
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ScanLine size={20} className="text-indigo-600" />
        <h1 className="text-xl font-bold text-gray-800">OCR อ่านฟอร์ม</h1>
        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Powered by Claude AI</span>
      </div>
      <p className="text-sm text-gray-500">อัปโหลดรูปถ่าย หรือไฟล์ PDF ของแบบฟอร์ม — AI จะอ่านข้อมูลและเติมฟอร์มให้อัตโนมัติ ตรวจทานแล้วกดบันทึก</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upload area */}
        <div className="space-y-3">
          <div
            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
            onDrop={onDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-600">ลากวางรูป/PDF หรือคลิกเพื่อเลือกไฟล์</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP, PDF — ขนาดไม่เกิน 10MB</p>
            <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </div>

          {ocrMut.isPending && (
            <div className="card flex items-center gap-3 text-indigo-600">
              <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              <span className="text-sm">AI กำลังอ่านฟอร์ม...</span>
            </div>
          )}

          {preview && (
            <div className="card p-2">
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                <Eye size={12} /> ไฟล์ต้นฉบับ {fileInfo?.isPdf && '(PDF)'}
              </div>
              {fileInfo?.isPdf ? (
                <a href={preview} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  <FileText size={28} className="text-rose-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{fileInfo.name}</p>
                    <p className="text-xs text-gray-400">คลิกเพื่อเปิดดู PDF</p>
                  </div>
                </a>
              ) : (
                <img src={preview} alt="form preview" className="w-full rounded-lg max-h-96 object-contain bg-gray-50" />
              )}
            </div>
          )}
        </div>

        {/* Extracted & form */}
        {extracted && (
          <div className="space-y-3">
            <div className={`card border-l-4 ${extracted.confidence === 'high' ? 'border-l-green-500' : extracted.confidence === 'medium' ? 'border-l-amber-500' : 'border-l-red-500'}`}>
              <div className="flex items-center gap-2 mb-2">
                {extracted.confidence === 'high' ? <CheckCircle size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-amber-500" />}
                <span className="text-sm font-medium">ความมั่นใจ: {extracted.confidence === 'high' ? 'สูง' : extracted.confidence === 'medium' ? 'ปานกลาง' : 'ต่ำ'}</span>
                {extracted.form_type && <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{extracted.form_type === 'issue' ? 'ใบเบิก' : 'ใบคืน'}</span>}
              </div>
              {extracted.uncertain_fields?.length > 0 && (
                <p className="text-xs text-amber-600">⚠️ ฟิลด์ที่ไม่แน่ใจ: {extracted.uncertain_fields.join(', ')}</p>
              )}
            </div>

            <div className="card space-y-3">
              <h3 className="font-medium text-gray-700 text-sm">ตรวจทานและแก้ไข</h3>

              <div>
                <label className="label">วันที่</label>
                <input type="date" className="input" {...register('date')} />
              </div>

              {formType === 'issue' ? (
                <>
                  <div>
                    <label className="label">สมาชิก</label>
                    <MemberSelect
                      members={members as any[]}
                      value={watch('member_id') ?? ''}
                      onChange={(id) => setValue('member_id', id)}
                    />
                    {extracted.member_code && <p className="text-xs text-gray-400 mt-1">AI อ่านได้: {extracted.member_code} {extracted.member_name}</p>}
                  </div>
                  <div>
                    <label className="label">สินค้า</label>
                    <select className="input" {...register('product_id')}>
                      <option value="">-- เลือกสินค้า --</option>
                      {(products as any[]).map((p: any) => <option key={p.id} value={p.id}>{colorDot(p.color)}{p.project ? `${p.project} · ` : ''}{p.name}</option>)}
                    </select>
                    {extracted.product_name && <p className="text-xs text-gray-400 mt-1">AI อ่านได้: {extracted.product_name}</p>}
                  </div>
                  <div>
                    <label className="label">จำนวนเบิก</label>
                    <input type="number" step="0.01" className="input" {...register('quantity')} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">ใบเบิกที่อ้างถึง</label>
                    <select className="input" value={selectedIssueId} onChange={e => setSelectedIssueId(e.target.value)}>
                      <option value="">-- เลือกใบเบิก --</option>
                      {allOpenIssues.map((i: any) => <option key={i.id} value={i.id}>{i.code} — {i.member_name} ({i.product_name})</option>)}
                    </select>
                    {extracted.issue_code && <p className="text-xs text-gray-400 mt-1">AI อ่านได้: {extracted.issue_code}</p>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="label">งานดี</label><input type="number" step="0.01" className="input" {...register('good_qty')} /></div>
                    <div><label className="label">งานเสีย</label><input type="number" step="0.01" className="input" {...register('defect_qty')} /></div>
                    <div><label className="label">เศษคืน</label><input type="number" step="0.01" className="input" {...register('waste_qty')} /></div>
                  </div>
                  <div>
                    <label className="label">ผู้ตรวจ</label>
                    <input className="input" {...register('inspector')} />
                  </div>
                </>
              )}

              <div>
                <label className="label">หมายเหตุ</label>
                <input className="input" {...register('notes')} />
              </div>

              {saveError && <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-600">{saveError}</div>}
              {saved && <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-600 flex items-center gap-2"><CheckCircle size={14} /> บันทึกสำเร็จแล้ว</div>}

              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1" onClick={onSave} disabled={saved}>
                  {saved ? 'บันทึกแล้ว ✓' : 'ยืนยันและบันทึก'}
                </button>
                {saved && <button className="btn-secondary" onClick={() => { setExtracted(null); setPreview(null); reset(); setSaved(false); setSelectedIssueId(''); }}>เริ่มใหม่</button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
