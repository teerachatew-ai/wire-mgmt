import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { memberApi, ocrApi, smartcardApi, reportApi } from '../api';
import { UserPlus, Search, X, Edit2, Trash2, ScanLine, Upload, CheckCircle, AlertCircle, Loader2, CreditCard, ShieldCheck, FileText, History } from 'lucide-react';
import ExportExcelButton from '../components/ExportExcelButton';

/* แปลงรายชื่อสมาชิกเป็นแถวสำหรับ export Excel */
function membersToRows(members: any[]) {
  return members.map(m => ({
    'รหัส': m.code, 'ชื่อ-สกุล': m.name, 'ชื่อเล่น': m.nickname || '',
    'เลขบัตรประชาชน': m.id_card || '', 'เบอร์โทร': m.phone || '', 'ที่อยู่': m.address || '',
    'ธนาคาร': m.bank_name || '', 'เลขบัญชี': m.bank_account || '',
    'สถานะ': m.status === 'active' ? 'ใช้งาน' : 'พักงาน',
    'เกรด': m.grade || '', 'งานเสียเกิน3%(ครั้ง)': m.ng_count ?? 0, 'จำนวนงาน': m.batch_count ?? 0,
    'PDPA': m.pdpa_consent ? 'ยินยอม' : 'ยังไม่ยินยอม', 'วันที่ลงทะเบียน': m.registered_at || '',
  }));
}

/* ── Performance grade badge ── */
export function GradeBadge({ grade, batches }: { grade: string; batches?: number }) {
  const styles: Record<string, string> = {
    A: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
    B: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
    C: 'bg-rose-100 text-rose-600 ring-1 ring-rose-300',
  };
  const label: Record<string, string> = { A: 'A · ดีเยี่ยม', B: 'B · ดี', C: 'C · ต้องพัฒนา' };
  if (batches === 0) return <span className="text-xs text-gray-300">ยังไม่มีงาน</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${styles[grade] || styles.B}`}>
      {grade === 'A' && <span aria-hidden>★</span>}{label[grade] || grade}
    </span>
  );
}

/* ── Smart Card Reader button ── */
function SmartCardButton({ onExtracted }: { onExtracted: (data: any) => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const read = async () => {
    setState('waiting');
    setErrorMsg('');
    try {
      const data = await smartcardApi.read();
      onExtracted(data);
      setState('done');
    } catch (e: any) {
      const msg = e.response?.data?.error ?? e.message ?? 'เกิดข้อผิดพลาด';
      setErrorMsg(msg);
      setState('error');
    }
  };

  if (state === 'idle' || state === 'done') return (
    <button
      type="button"
      onClick={read}
      className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors"
    >
      <CreditCard size={18} />
      {state === 'done' ? '✅ อ่านบัตรสำเร็จ — อ่านใหม่' : 'อ่านจากเครื่องเสียบบัตร'}
    </button>
  );

  if (state === 'waiting') return (
    <div className="w-full flex items-center justify-center gap-3 bg-green-50 border-2 border-green-300 rounded-xl py-3 px-4">
      <Loader2 size={20} className="animate-spin text-green-600" />
      <span className="text-green-700 font-medium">กำลังอ่านบัตร... (เสียบบัตรถ้ายังไม่ได้เสียบ)</span>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-red-600 text-sm">
        <AlertCircle size={16} />
        <span>{errorMsg}</span>
      </div>
      <button
        type="button"
        onClick={read}
        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors"
      >
        <CreditCard size={18} /> ลองอีกครั้ง
      </button>
    </div>
  );
}

/* ── ID Card OCR strip ── */
function IdCardScanner({ onExtracted }: { onExtracted: (data: any) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [uncertain, setUncertain] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const process = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setState('loading');
    setErrorMsg('');
    try {
      const result = await ocrApi.readIdCard(file);
      const ex = result.extracted;
      setConfidence(ex.confidence ?? 'medium');
      setUncertain(ex.uncertain_fields ?? []);
      onExtracted(ex);
      setState('done');
    } catch (e: any) {
      setErrorMsg(e.response?.data?.error ?? e.message ?? 'เกิดข้อผิดพลาด');
      setState('error');
    }
  }, [onExtracted]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) process(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) process(f);
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white">
        <ScanLine size={16} />
        <span className="text-sm font-semibold">สแกนบัตรประชาชน</span>
        <span className="ml-auto text-xs opacity-80">รองรับรูปถ่าย / สแกน ทั้ง 2 ด้าน</span>
      </div>

      <div className="p-3 flex gap-3 items-start">
        {/* Drop zone / preview */}
        <div
          className="shrink-0 w-36 h-24 rounded-lg border border-blue-200 bg-white flex items-center justify-center cursor-pointer overflow-hidden relative hover:border-blue-400 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
        >
          {preview ? (
            <img src={preview} alt="id card" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-blue-400 p-2">
              <Upload size={22} className="mx-auto mb-1" />
              <span className="text-xs">แนบรูปบัตร</span>
            </div>
          )}
          {state === 'loading' && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          )}
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        </div>

        {/* Status / result */}
        <div className="flex-1 min-w-0">
          {state === 'idle' && (
            <div className="text-sm text-blue-700 space-y-1">
              <p className="font-medium">วิธีใช้</p>
              <p className="text-xs text-blue-600 leading-relaxed">
                ถ่ายรูปหรือแนบไฟล์บัตรประชาชน — AI จะอ่านชื่อ เลขบัตร และที่อยู่ แล้วกรอกฟอร์มให้อัตโนมัติ
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-1"
                >
                  <Upload size={13} /> แนบรูปจากเครื่อง
                </button>
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="text-xs bg-white border border-blue-300 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors inline-flex items-center gap-1"
                >
                  <ScanLine size={13} /> ถ่ายรูป
                </button>
              </div>
            </div>
          )}

          {state === 'loading' && (
            <div className="flex items-center gap-2 text-blue-700 text-sm">
              <Loader2 size={16} className="animate-spin" />
              <span>AI กำลังอ่านบัตร...</span>
            </div>
          )}

          {state === 'done' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className={confidence === 'high' ? 'text-green-500' : 'text-amber-500'} />
                <span className="text-sm font-medium text-gray-700">
                  อ่านสำเร็จ — ความมั่นใจ: {confidence === 'high' ? 'สูง' : confidence === 'medium' ? 'ปานกลาง' : 'ต่ำ'}
                </span>
              </div>
              {uncertain.length > 0 && (
                <p className="text-xs text-amber-600">
                  ⚠️ ตรวจสอบ: {uncertain.join(', ')}
                </p>
              )}
              <button
                type="button"
                onClick={() => { setState('idle'); setPreview(null); }}
                className="text-xs text-blue-600 hover:underline"
              >
                สแกนบัตรใหม่
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-red-500" />
                <span className="text-sm font-medium text-red-600">อ่านไม่สำเร็จ</span>
              </div>
              <p className="text-xs text-red-500">{errorMsg}</p>
              <button
                type="button"
                onClick={() => { setState('idle'); setPreview(null); }}
                className="text-xs text-blue-600 hover:underline"
              >
                ลองอีกครั้ง
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Modal wrapper ── */
function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ── Member form ── */
function MemberForm({ defaultValues, onSubmit, loading, isEdit }: any) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<any>({ defaultValues });

  const handleIdCardData = useCallback((data: any) => {
    if (data.full_name) setValue('name', data.full_name);
    if (data.id_number) setValue('id_card', data.id_number);
    if (data.address) setValue('address', data.address);
  }, [setValue]);

  const handleSmartCardData = useCallback((data: any) => {
    if (data.name) setValue('name', data.name);
    if (data.id_card) setValue('id_card', data.id_card);
    if (data.address) setValue('address', data.address);
  }, [setValue]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Smart card reader + OCR — ใช้ได้ทั้งตอนเพิ่มและแก้ไข (แก้ไข = เขียนทับด้วยข้อมูลจากบัตรจริง) */}
      <div className="space-y-2">
        {isEdit && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ เสียบบัตร/สแกนรูปแล้ว จะ<strong>เขียนทับ</strong>ชื่อ-สกุล, เลขบัตรประชาชน, ที่อยู่ ด้วยข้อมูลจากบัตรจริง
          </p>
        )}
        <SmartCardButton onExtracted={handleSmartCardData} />
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="flex-1 h-px bg-gray-200" />
          <span>หรือสแกนรูปบัตร</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <IdCardScanner onExtracted={handleIdCardData} />
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">ข้อมูลสมาชิก</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">ชื่อ-สกุล *</label>
            <input className="input" {...register('name', { required: 'กรุณากรอกชื่อ' })} placeholder="นาย/นาง/นางสาว ชื่อ นามสกุล" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message as string}</p>}
          </div>
          <div className="col-span-2">
            <label className="label">ชื่อเล่น</label>
            <input className="input" {...register('nickname')} placeholder="เช่น พี่สมชาย, ป้าแดง" />
          </div>
          <div>
            <label className="label">เลขบัตรประชาชน</label>
            <input className="input font-mono tracking-wider" maxLength={13} placeholder="1234567890123" {...register('id_card')} />
          </div>
          <div>
            <label className="label">เบอร์โทรศัพท์</label>
            <input className="input" placeholder="0812345678" {...register('phone')} />
          </div>
          <div>
            <label className="label">วันที่ลงทะเบียน</label>
            <input type="date" className="input" {...register('registered_at')}
              defaultValue={new Date().toISOString().split('T')[0]} />
          </div>
          {isEdit && (
            <div>
              <label className="label">สถานะ</label>
              <select className="input" {...register('status')}>
                <option value="active">ใช้งาน</option>
                <option value="inactive">พักงาน</option>
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="label">ที่อยู่</label>
          <textarea className="input" rows={2} {...register('address')} placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด" />
        </div>

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1">ข้อมูลบัญชีธนาคาร</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">ธนาคาร</label>
            <select className="input" {...register('bank_name')}>
              <option value="">-- เลือกธนาคาร --</option>
              {['กรุงเทพ', 'กสิกรไทย', 'ไทยพาณิชย์', 'กรุงไทย', 'กรุงศรีอยุธยา', 'ออมสิน', 'ธ.ก.ส.', 'ทหารไทยธนชาต', 'อื่นๆ'].map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">เลขบัญชี</label>
            <input className="input font-mono" {...register('bank_account')} placeholder="xxx-x-xxxxx-x" />
          </div>
        </div>
      </div>

      {/* PDPA consent */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
        <div className="flex items-center gap-2 text-blue-700">
          <ShieldCheck size={18} />
          <span className="font-semibold text-sm">ความยินยอมเก็บข้อมูล (PDPA)</span>
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" className="mt-1 w-5 h-5 accent-blue-600 shrink-0" {...register('pdpa_consent')} />
          <span className="text-sm text-gray-700 leading-relaxed">
            สมาชิก<strong>ยินยอม</strong>ให้กลุ่มเก็บและใช้ข้อมูลส่วนตัว (ชื่อ เลขบัตรประชาชน ที่อยู่ เบอร์โทร เลขบัญชี)
            เพื่อขึ้นทะเบียนสมาชิก คำนวณค่าแรง และโอนเงิน โดยเก็บเป็นความลับ
          </span>
        </label>
        {isEdit && watch('pdpa_consent') && defaultValues?.pdpa_consent_at && (
          <p className="text-xs text-green-600 pl-7">✓ ยินยอมเมื่อ {defaultValues.pdpa_consent_at}</p>
        )}
        <button
          type="button"
          onClick={() => {
            const p = new URLSearchParams({
              name: watch('name') || '',
              idcard: watch('id_card') || '',
              code: defaultValues?.code || '',
              consent: watch('pdpa_consent') ? '1' : '0',
            });
            window.open(`/pdpa?${p.toString()}`, '_blank', 'width=900,height=700,scrollbars=yes');
          }}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium pl-7"
        >
          <FileText size={15} /> พิมพ์เอกสารยินยอมให้สมาชิกเซ็น (PDF)
        </button>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มสมาชิก'}
        </button>
      </div>
    </form>
  );
}

/* ── Confirm Delete Dialog ── */
function DeleteDialog({ member, onClose, onDeleted }: { member: any; onClose: () => void; onDeleted: () => void }) {
  const [step, setStep] = useState<'confirm' | 'loading' | 'error'>('confirm');
  const [msg, setMsg] = useState('');
  const [needForce, setNeedForce] = useState(false);

  const doDelete = async (force = false) => {
    setStep('loading');
    try {
      await memberApi.delete(member.id, force);
      onDeleted();
      onClose();
    } catch (e: any) {
      const data = e.response?.data;
      if (data?.confirm_required) {
        setMsg(data.message);
        setNeedForce(true);
        setStep('confirm');
      } else {
        setMsg(data?.error ?? 'เกิดข้อผิดพลาด');
        setStep('error');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-lg shrink-0">
              <Trash2 size={20} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">ลบสมาชิก</h3>
              <p className="text-sm text-gray-500 mt-0.5">{member.name} ({member.code})</p>
            </div>
          </div>

          {step === 'loading' && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 size={16} className="animate-spin" /> กำลังลบ...
            </div>
          )}

          {step === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
              {msg}
            </div>
          )}

          {step === 'confirm' && !needForce && (
            <p className="text-sm text-gray-600">ต้องการลบสมาชิกนี้ออกจากระบบ? การกระทำนี้ไม่สามารถยกเลิกได้</p>
          )}

          {step === 'confirm' && needForce && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              ⚠️ {msg}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-secondary" onClick={onClose} disabled={step === 'loading'}>
              ยกเลิก
            </button>
            {step !== 'error' && (
              <button
                className="btn-danger"
                disabled={step === 'loading'}
                onClick={() => doDelete(needForce)}
              >
                {needForce ? 'ยืนยันลบถาวร' : 'ลบ'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Member work-history modal ── */
function HistoryModal({ member, onClose }: { member: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-history', member.id],
    queryFn: () => reportApi.memberHistory(member.id),
  });
  return (
    <Modal title={`ประวัติงาน — ${member.name}`} onClose={onClose}>
      {isLoading && <div className="py-10 text-center text-gray-400"><Loader2 size={22} className="animate-spin mx-auto" /></div>}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-green-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">งานดีรวม</p>
              <p className="text-xl font-bold text-green-700 tabular-nums">{data.defect_summary.total_good}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">งานเสียรวม</p>
              <p className="text-xl font-bold text-red-500 tabular-nums">{data.defect_summary.total_defect}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">% ของเสีย</p>
              <p className={`text-xl font-bold tabular-nums ${parseFloat(data.defect_summary.defect_pct) > 5 ? 'text-red-600' : 'text-green-700'}`}>
                {data.defect_summary.defect_pct}%
              </p>
            </div>
          </div>
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium">ใบเบิก</th>
                  <th className="px-3 py-2.5 font-medium">สินค้า</th>
                  <th className="px-3 py-2.5 font-medium">วันที่</th>
                  <th className="px-3 py-2.5 font-medium text-right">เบิก</th>
                  <th className="px-3 py-2.5 font-medium text-right">งานดี</th>
                  <th className="px-3 py-2.5 font-medium text-right">ค่าแรง</th>
                  <th className="px-3 py-2.5 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.issues.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">ยังไม่มีประวัติงาน</td></tr>
                )}
                {data.issues.map((i: any) => (
                  <tr key={i.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-mono text-xs text-blue-600 font-semibold">{i.code}</td>
                    <td className="px-3 py-2.5 text-gray-700">{i.product_name}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{i.issued_at}</td>
                    <td className="px-3 py-2.5 text-right">{i.quantity} {i.unit}</td>
                    <td className="px-3 py-2.5 text-right text-green-600">{i.good_qty}</td>
                    <td className="px-3 py-2.5 text-right text-green-700 font-medium">{(i.good_qty * i.wage_per_unit).toFixed(2)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`badge-${i.status}`}>{i.status === 'pending' ? 'ค้าง' : i.status === 'partial' ? 'บางส่วน' : 'ปิด'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Main page ── */
export default function Members() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [apiError, setApiError] = useState('');
  const [deleting, setDeleting] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['members', q],
    queryFn: () => memberApi.list({ q: q || undefined })
  });

  // ทั้งหมด (ไม่กรองค้นหา) สำหรับสรุปด้านบน
  const { data: allMembers = [] } = useQuery({
    queryKey: ['members', '__all'],
    queryFn: () => memberApi.list()
  });
  const all = allMembers as any[];
  const stats = {
    total: all.length,
    active: all.filter(m => m.status === 'active').length,
    inactive: all.filter(m => m.status === 'inactive').length,
    A: all.filter(m => m.grade === 'A').length,
    B: all.filter(m => m.grade === 'B').length,
    C: all.filter(m => m.grade === 'C').length,
  };

  const createMut = useMutation({
    mutationFn: memberApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); setModal(null); setApiError(''); },
    onError: (e: any) => setApiError(e.response?.data?.error ?? 'เกิดข้อผิดพลาด')
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => memberApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); setModal(null); setApiError(''); },
    onError: (e: any) => setApiError(e.response?.data?.error ?? 'เกิดข้อผิดพลาด')
  });

  const openAdd = () => { setEditing(null); setApiError(''); setModal('add'); };
  const openEdit = (m: any) => { setEditing(m); setApiError(''); setModal('edit'); };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">ทะเบียนสมาชิก</h1>
        <div className="flex items-center gap-2">
          <ExportExcelButton filename={`รายชื่อสมาชิก-${new Date().toISOString().split('T')[0]}`} rows={membersToRows(data as any[])} />
          <button className="btn-primary btn-sm flex items-center gap-2" onClick={openAdd}>
            <UserPlus size={16} /> เพิ่มสมาชิก
          </button>
        </div>
      </div>

      {/* Summary dashboard — grouped */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* กลุ่ม 1: สถานะสมาชิก */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-3">สถานะสมาชิก</p>
          <div className="flex items-stretch gap-3">
            <div className="flex-1 rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-slate-800 leading-none">{stats.total}</p>
              <p className="text-xs text-slate-500 mt-1.5">ทั้งหมด (คน)</p>
            </div>
            <div className="flex-1 rounded-xl bg-green-50 p-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-green-700 leading-none">{stats.active}</p>
              <p className="text-xs text-green-700/80 mt-1.5">ใช้งาน</p>
            </div>
            <div className="flex-1 rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-gray-500 leading-none">{stats.inactive}</p>
              <p className="text-xs text-gray-500 mt-1.5">พักงาน</p>
            </div>
          </div>
        </div>

        {/* กลุ่ม 2: เกรดผลงาน */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-3">เกรดผลงาน (อิงงานเสีย NG)</p>
          <div className="flex items-stretch gap-3">
            <div className="flex-1 rounded-xl bg-amber-50 p-3 text-center ring-1 ring-amber-200">
              <p className="text-3xl font-bold tabular-nums text-amber-700 leading-none">{stats.A}</p>
              <p className="text-xs text-amber-700/80 mt-1.5">★ เกรด A</p>
            </div>
            <div className="flex-1 rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-slate-600 leading-none">{stats.B}</p>
              <p className="text-xs text-slate-500 mt-1.5">เกรด B</p>
            </div>
            <div className="flex-1 rounded-xl bg-rose-50 p-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-rose-600 leading-none">{stats.C}</p>
              <p className="text-xs text-rose-600/80 mt-1.5">เกรด C</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative md:max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="ค้นหาชื่อ, ชื่อเล่น, รหัส, เบอร์..." value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {isLoading && <div className="text-center text-gray-400 py-8">กำลังโหลด...</div>}
        {!isLoading && (data as any[]).length === 0 && <div className="text-center text-gray-400 py-8">ยังไม่มีข้อมูล</div>}
        {(data as any[]).map((m: any) => (
          <div key={m.id} className={`card space-y-3 ${m.status === 'active' ? '' : 'bg-gray-50'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-xs text-blue-600 font-bold">{m.code}</span>
                <p className={`font-semibold text-base mt-0.5 ${m.status === 'active' ? 'text-gray-800' : 'text-gray-400'}`}>
                  {m.name}
                  {m.nickname && <span className="text-sm text-gray-400 font-normal"> ({m.nickname})</span>}
                </p>
                {m.phone && <p className="text-sm text-gray-500 mt-0.5">📞 {m.phone}</p>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={m.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                  <span className={`w-2 h-2 rounded-full ${m.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  {m.status === 'active' ? 'ใช้งาน' : 'พักงาน'}
                </span>
                <GradeBadge grade={m.grade} batches={m.batch_count} />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm border-t pt-2.5">
              <div className="flex items-center gap-3">
                {m.pdpa_consent
                  ? <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium"><ShieldCheck size={14} /> PDPA</span>
                  : <span className="text-xs text-gray-400">ยังไม่ยินยอม PDPA</span>}
                {m.pending_units > 0 && <span className="text-xs text-amber-600 font-medium">ค้าง {m.pending_units}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 whitespace-nowrap"
                  onClick={() => setHistory(m)}
                ><History size={14} /> ประวัติ</button>
                <button className="p-2 text-gray-400 hover:text-blue-600" onClick={() => {
                  const p = new URLSearchParams({ name: m.name || '', idcard: m.id_card || '', code: m.code || '', consent: m.pdpa_consent ? '1' : '0' });
                  window.open(`/pdpa?${p.toString()}`, '_blank', 'width=900,height=700,scrollbars=yes');
                }}><FileText size={18} /></button>
                <button className="p-2 text-gray-400 hover:text-amber-600" onClick={() => openEdit(m)}><Edit2 size={18} /></button>
                <button className="p-2 text-gray-400 hover:text-red-600" onClick={() => setDeleting(m)}><Trash2 size={18} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">รหัส</th>
              <th className="px-4 py-3 font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-3 font-medium">เลขบัตร</th>
              <th className="px-4 py-3 font-medium">เบอร์โทร</th>
              <th className="px-4 py-3 font-medium text-right">งานค้าง</th>
              <th className="px-4 py-3 font-medium">เกรด</th>
              <th className="px-4 py-3 font-medium">PDPA</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="py-8 text-center text-gray-400">กำลังโหลด...</td></tr>}
            {!isLoading && (data as any[]).length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>
            )}
            {(data as any[]).map((m: any) => (
              <tr key={m.id} className={`border-b hover:brightness-95 transition-colors ${m.status === 'active' ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">{m.code}</td>
                <td className={`px-4 py-3 font-medium whitespace-nowrap ${m.status === 'active' ? 'text-gray-800' : 'text-gray-400'}`}>
                  {m.name}
                  {m.nickname && <span className="ml-2 text-sm text-gray-400">({m.nickname})</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">
                  {m.id_card ? `${m.id_card.slice(0, 1)}-${m.id_card.slice(1, 5)}-${m.id_card.slice(5, 10)}-${m.id_card.slice(10, 12)}-${m.id_card.slice(12)}` : '-'}
                </td>
                <td className="px-4 py-3 text-gray-500">{m.phone || '-'}</td>
                <td className="px-4 py-3 text-right">
                  <span className={m.pending_units > 0 ? 'text-amber-600 font-medium' : 'text-gray-300'}>
                    {m.pending_units > 0 ? `${m.pending_issues} ใบ / ${m.pending_units} หน่วย` : '-'}
                  </span>
                </td>
                <td className="px-4 py-3"><GradeBadge grade={m.grade} batches={m.batch_count} /></td>
                <td className="px-4 py-3">
                  {m.pdpa_consent ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium"><ShieldCheck size={14} /> ยินยอม</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">ยังไม่ยินยอม</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={m.status === 'active' ? 'badge-active' : 'badge-inactive'}>
                    <span className={`w-2 h-2 rounded-full ${m.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {m.status === 'active' ? 'ใช้งาน' : 'พักงาน'}
                  </span>
                </td>
                <td className="px-4 py-3 flex items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                    onClick={() => setHistory(m)}
                  >
                    <History size={13} /> ประวัติ
                  </button>
                  <button className="text-gray-400 hover:text-blue-600" title="พิมพ์เอกสาร PDPA" onClick={() => {
                    const p = new URLSearchParams({ name: m.name || '', idcard: m.id_card || '', code: m.code || '', consent: m.pdpa_consent ? '1' : '0' });
                    window.open(`/pdpa?${p.toString()}`, '_blank', 'width=900,height=700,scrollbars=yes');
                  }}>
                    <FileText size={15} />
                  </button>
                  <button className="text-gray-400 hover:text-blue-600" title="แก้ไข" onClick={() => openEdit(m)}>
                    <Edit2 size={15} />
                  </button>
                  <button className="text-gray-400 hover:text-red-600" title="ลบ" onClick={() => setDeleting(m)}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history && <HistoryModal member={history} onClose={() => setHistory(null)} />}

      {deleting && (
        <DeleteDialog
          member={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['members'] }); setDeleting(null); }}
        />
      )}

      {modal && (
        <Modal
          title={modal === 'add' ? 'เพิ่มสมาชิกใหม่' : `แก้ไขข้อมูล — ${editing?.name}`}
          onClose={() => setModal(null)}
        >
          <MemberForm
            defaultValues={modal === 'edit' ? editing : {}}
            isEdit={modal === 'edit'}
            loading={createMut.isPending || updateMut.isPending}
            onSubmit={(data: any) => {
              if (modal === 'add') createMut.mutate(data);
              else updateMut.mutate({ id: editing.id, data });
            }}
          />
          {apiError && (
            <p className="text-red-500 text-sm mt-2 text-center">{apiError}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
