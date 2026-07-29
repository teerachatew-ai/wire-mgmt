import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SARABUN_REGULAR_BASE64, SARABUN_BOLD_BASE64 } from '../assets/fonts/sarabun-base64';
import { portalApi } from '../api';
import { CheckCircle2, Clock, XCircle, PackageOpen, ArrowLeft, Send, Loader2, PackagePlus, ChevronRight, ChevronDown, RotateCcw, ClipboardList, Calendar, Download } from 'lucide-react';

const fmtQty = (n: number) => Number(n || 0).toLocaleString('th-TH');
const money = (n: number) => `฿${Number(n || 0).toLocaleString('th-TH')}`;
// วันที่วันนี้ตามเวลาเครื่อง (local) ของสมาชิก — ห้ามใช้ toISOString() ตรงๆ เพราะแปลงเป็น UTC ก่อน
// ทำให้ช่วงเที่ยงคืนถึงตี 7 เวลาไทย จะได้ "เมื่อวาน" แทนวันนี้จริง (ประเทศไทยเร็วกว่า UTC 7 ชม.)
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function greetingText() {
  const h = new Date().getHours();
  if (h < 11) return 'สวัสดีตอนเช้า';
  if (h < 17) return 'สวัสดีตอนบ่าย';
  return 'สวัสดีตอนเย็น';
}
function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
}
// PDF ที่ export ใช้ตัวอักษรฝังไปในไฟล์ (ไม่พึ่งฟอนต์ระบบ) ต้องลงทะเบียนฟอนต์ไทยเองก่อนเขียนข้อความ
// ใช้คำว่า "บาท" แทนสัญลักษณ์ ฿ ในเอกสาร PDF เพราะฟอนต์ที่ฝังไม่การันตีว่ามีสัญลักษณ์นี้ครบ
function registerSarabunFont(doc: jsPDF) {
  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
  doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
  doc.setFont('Sarabun', 'normal');
}
const fmtMoneyForPdf = (n: number) => `${Number(n || 0).toLocaleString('th-TH')} บาท`;
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const statusInfo: Record<string, { label: string; cls: string; icon: any }> = {
  pending: { label: 'รอตรวจสอบ', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  confirmed: { label: 'ยืนยันแล้ว', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  rejected: { label: 'ไม่ผ่าน', cls: 'bg-rose-100 text-rose-700', icon: XCircle },
};

// ชื่อกลุ่มงานที่สมาชิกคุ้นเคย (ชื่อรหัสโครงการจริง COT0xx ใช้เฉพาะฝั่งเจ้าหน้าที่)
const PROJECT_LABEL: Record<string, string> = {
  COT091: 'งานป้ายขาว',
  COT092: 'งานป้ายชมพู',
  COT102: 'งาน 3 สาย',
};
const projectLabel = (key: string) => PROJECT_LABEL[key] || key;

// แยกชื่อสินค้า "MA020-633_A (ป้ายขาวสั้น)" -> เลขรุ่น "633" (บรรทัดบน) + ชื่อเรียก "ป้ายขาวสั้น" (บรรทัดล่าง)
function parseProductLabel(name: string) {
  const num = name.match(/-(\d+)/)?.[1] || '';
  const label = name.match(/\(([^)]+)\)/)?.[1] || name;
  return { num, label };
}

/* ── เบิกงานใหม่ — เลือกได้หลายชนิด กรอกจำนวนแต่ละชนิดไว้ก่อน แล้วค่อยกด "ส่ง" ครั้งเดียวรวมกันท้ายสุด ── */
function IssueRequestScreen({ token, products, onDone, onCancel }: { token: string; products: any[]; onDone: () => void; onCancel: () => void }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [issuedAt, setIssuedAt] = useState(todayLocal());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: number) => setExpanded(e => ({ ...e, [id]: !e[id] }));
  const setQtyFor = (id: number, v: string) => setQty(q => ({ ...q, [id]: v }));

  const groups = Object.values(
    (products || []).reduce((acc: any, p: any) => {
      const key = p.project || 'สินค้า';
      (acc[key] ??= { key, products: [] }).products.push(p);
      return acc;
    }, {})
  ) as any[];

  // รายการที่กรอกจำนวนไว้แล้ว (>0) — พร้อมส่งพร้อมกันตอนกดปุ่มด้านล่าง
  const picked = (products || [])
    .map((p: any) => ({ product: p, quantity: parseFloat(qty[p.id]) || 0 }))
    .filter((x: any) => x.quantity > 0);

  const submit = async () => {
    if (picked.length === 0 || submitting) return;
    setSubmitting(true); setError('');
    const failedNames: string[] = [];
    for (const it of picked) {
      try {
        await portalApi.submitIssue(token, { product_id: it.product.id, quantity: it.quantity, issued_at: issuedAt });
        setQtyFor(it.product.id, ''); // ส่งสำเร็จแล้ว เคลียร์ช่องนี้ไว้กันส่งซ้ำถ้าต้องลองใหม่
      } catch {
        failedNames.push(it.product.name);
      }
    }
    setSubmitting(false);
    if (failedNames.length > 0) {
      setError(`ส่งไม่สำเร็จ: ${failedNames.join(', ')} — รายการอื่นส่งสำเร็จแล้ว ลองส่งรายการที่เหลือใหม่อีกครั้ง`);
    } else {
      onDone();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-28">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <p className="font-bold text-lg text-gray-800">เบิกงานใหม่</p>
      </div>
      <div className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full">
        <p className="text-sm text-gray-500 px-1">เลือกได้หลายชนิด กรอกจำนวนไว้ทีละชนิด แล้วค่อยกดส่งรวมกันทีเดียวด้านล่าง</p>

        <div className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-gray-600 shrink-0">วันที่เบิก</label>
          <input type="date" className="input !w-auto text-right" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} />
        </div>

        {groups.length === 0 && (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400">ยังไม่มีสินค้าให้เลือก ติดต่อเจ้าหน้าที่</div>
        )}
        {groups.map((g: any) => (
          <div key={g.key}>
            {g.key !== 'สินค้า' && <p className="text-sm font-semibold text-gray-500 px-1 mb-2">{projectLabel(g.key)}</p>}
            <div className="space-y-2">
              {g.products.map((p: any) => {
                const open = !!expanded[p.id];
                const q = qty[p.id] || '';
                const hasQty = (parseFloat(q) || 0) > 0;
                return (
                  <div key={p.id} className={`bg-white rounded-2xl border-2 overflow-hidden transition-colors ${hasQty ? 'border-blue-400' : 'border-gray-100'}`}>
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className="w-full p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
                    >
                      {p.color && <span className="w-6 h-6 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                      <span className="flex-1 font-semibold text-gray-800">{p.name}</span>
                      {hasQty && !open && (
                        <span className="text-sm font-bold text-blue-700 bg-blue-50 rounded-lg px-2.5 py-1 shrink-0">{q} {p.unit}</span>
                      )}
                      {open ? <ChevronDown size={20} className="text-blue-500 shrink-0" /> : <ChevronRight size={20} className="text-gray-300 shrink-0" />}
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100">
                        <div className="text-center">
                          <label className="block text-base font-semibold text-gray-700 mb-2">ขอเบิกกี่{p.unit || 'เส้น'}?</label>
                          <input
                            type="number" inputMode="numeric" min={0} autoFocus
                            className="w-full text-center text-3xl font-bold text-blue-700 border-b-4 border-blue-200 focus:border-blue-500 outline-none py-1 bg-transparent"
                            placeholder="0"
                            value={q}
                            onChange={e => setQtyFor(p.id, e.target.value)}
                          />
                          <p className="text-sm text-gray-400 mt-1">{p.unit}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* แถบส่งรวมด้านล่าง — ลอยติดล่างไว้เสมอ กดครั้งเดียวส่งทุกชนิดที่กรอกไว้พร้อมกัน */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-10">
        <div className="max-w-md mx-auto w-full">
          {error && <p className="text-rose-600 text-sm text-center font-medium mb-2">{error}</p>}
          <button
            type="button"
            disabled={picked.length === 0 || submitting}
            onClick={submit}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 disabled:bg-gray-300 text-white font-bold text-lg py-3.5 rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
          >
            {submitting ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            {picked.length === 0 ? 'ส่งคำขอเบิกงาน' : `ส่งคำขอเบิกงาน (${picked.length} ชนิด)`}
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">เจ้าหน้าที่จะตรวจสอบแล้วอนุมัติอีกครั้ง</p>
        </div>
      </div>
    </div>
  );
}

/* ── คืนงาน — เลือกได้หลายรายการ กรอกจำนวนแต่ละรายการไว้ก่อน แล้วค่อยกด "ส่ง" ครั้งเดียวรวมกันท้ายสุด ── */
function ReturnListScreen({ token, openIssues, onDone, onCancel }: { token: string; openIssues: any[]; onDone: () => void; onCancel: () => void }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [goodQty, setGoodQty] = useState<Record<number, string>>({});
  const [hasProblem, setHasProblem] = useState<Record<number, boolean>>({});
  const [ngCut, setNgCut] = useState<Record<number, string>>({});
  const [ngFactory, setNgFactory] = useState<Record<number, string>>({});
  const [lost, setLost] = useState<Record<number, string>>({});
  const [returnedAt, setReturnedAt] = useState(todayLocal());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: number) => setExpanded(e => ({ ...e, [id]: !e[id] }));
  const totalFor = (id: number) => (parseFloat(goodQty[id]) || 0) + (parseFloat(ngCut[id]) || 0) + (parseFloat(ngFactory[id]) || 0) + (parseFloat(lost[id]) || 0);

  const picked = openIssues
    .map((i: any) => ({ issue: i, good: parseFloat(goodQty[i.id]) || 0, ngC: parseFloat(ngCut[i.id]) || 0, ngF: parseFloat(ngFactory[i.id]) || 0, lostQ: parseFloat(lost[i.id]) || 0 }))
    .filter((x: any) => (x.good + x.ngC + x.ngF + x.lostQ) > 0);

  const submit = async () => {
    if (picked.length === 0 || submitting) return;
    setSubmitting(true); setError('');
    const failedNames: string[] = [];
    for (const it of picked) {
      try {
        await portalApi.submitReturn(token, {
          issue_id: it.issue.id,
          good_qty: it.good,
          ng_cut: it.ngC,
          ng_factory: it.ngF,
          lost_qty: it.lostQ,
          returned_at: returnedAt,
        });
        const id = it.issue.id;
        setGoodQty(q => ({ ...q, [id]: '' }));
        setNgCut(q => ({ ...q, [id]: '' }));
        setNgFactory(q => ({ ...q, [id]: '' }));
        setLost(q => ({ ...q, [id]: '' }));
      } catch {
        failedNames.push(it.issue.product_name);
      }
    }
    setSubmitting(false);
    if (failedNames.length > 0) {
      setError(`ส่งไม่สำเร็จ: ${failedNames.join(', ')} — รายการอื่นส่งสำเร็จแล้ว ลองส่งรายการที่เหลือใหม่อีกครั้ง`);
    } else {
      onDone();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-28">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <p className="font-bold text-lg text-gray-800">คืนงาน</p>
      </div>
      <div className="flex-1 p-4 space-y-3 max-w-md mx-auto w-full">
        {openIssues.length === 0 ? (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400">
            <PackageOpen size={32} className="mx-auto mb-2 opacity-50" />
            ตอนนี้ไม่มีงานค้างเบิก
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 px-1">เลือกได้หลายรายการ กรอกจำนวนไว้ทีละรายการ แล้วค่อยกดส่งรวมกันทีเดียวด้านล่าง</p>

            <div className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-gray-600 shrink-0">วันที่คืน</label>
              <input type="date" className="input !w-auto text-right" value={returnedAt} onChange={e => setReturnedAt(e.target.value)} />
            </div>

            {openIssues.map((i: any) => {
              const open = !!expanded[i.id];
              const total = totalFor(i.id);
              const hasQty = total > 0;
              const over = total > i.remaining + 0.001;
              return (
                <div key={i.id} className={`bg-white rounded-2xl border-2 overflow-hidden transition-colors ${hasQty ? (over ? 'border-rose-300' : 'border-blue-400') : 'border-gray-100'}`}>
                  <button type="button" onClick={() => toggle(i.id)} className="w-full p-4 text-left active:scale-[0.99] transition-transform">
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 mb-2.5">
                      <Calendar size={12} /> เบิกเมื่อ {fmtDate(i.issued_at)}
                    </span>
                    <div className="flex items-center gap-3">
                      {i.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: i.color }} />}
                      <span className="flex-1 font-bold text-gray-800">{i.product_name}</span>
                      {hasQty && !open && (
                        <span className="text-sm font-bold text-blue-700 bg-blue-50 rounded-lg px-2.5 py-1 shrink-0">{fmtQty(total)} {i.unit}</span>
                      )}
                      {open ? <ChevronDown size={20} className="text-blue-500 shrink-0" /> : <ChevronRight size={20} className="text-gray-300 shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">คงเหลือที่ต้องคืน <b className="text-gray-600">{fmtQty(i.remaining)} {i.unit}</b></p>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                      <div className="text-center">
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">ตัดเสร็จแล้วกี่{i.unit}?</label>
                        <input
                          type="number" inputMode="numeric" min={0} autoFocus
                          className="w-full text-center text-3xl font-bold text-blue-700 border-b-4 border-blue-200 focus:border-blue-500 outline-none py-1 bg-transparent"
                          placeholder="0"
                          value={goodQty[i.id] || ''}
                          onChange={e => setGoodQty(q => ({ ...q, [i.id]: e.target.value }))}
                        />
                      </div>
                      {!hasProblem[i.id] ? (
                        <button type="button" onClick={() => setHasProblem(h => ({ ...h, [i.id]: true }))} className="w-full text-center text-gray-500 text-sm py-1 underline">
                          มีของเสีย / ของหายไหม?
                        </button>
                      ) : (
                        <div className="space-y-2 pt-1">
                          <div>
                            <label className="text-xs text-gray-500">งานเสียจากการตัด</label>
                            <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={ngCut[i.id] || ''} onChange={e => setNgCut(q => ({ ...q, [i.id]: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">งานเสียจากโรงงาน</label>
                            <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={ngFactory[i.id] || ''} onChange={e => setNgFactory(q => ({ ...q, [i.id]: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">งานหาย</label>
                            <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={lost[i.id] || ''} onChange={e => setLost(q => ({ ...q, [i.id]: e.target.value }))} />
                          </div>
                        </div>
                      )}
                      {over && <p className="text-rose-600 text-xs text-center font-medium">⚠️ รวมแล้วเกินจำนวนที่เบิกไป</p>}
                      {i.pending_total > 0 && <p className="text-xs text-amber-600 text-center">🕐 มีคำขอรอตรวจสอบอยู่ {fmtQty(i.pending_total)} {i.unit}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {openIssues.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-10">
          <div className="max-w-md mx-auto w-full">
            {error && <p className="text-rose-600 text-sm text-center font-medium mb-2">{error}</p>}
            <button
              type="button"
              disabled={picked.length === 0 || submitting}
              onClick={submit}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 disabled:bg-gray-300 text-white font-bold text-lg py-3.5 rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
            >
              {submitting ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
              {picked.length === 0 ? 'ส่งแจ้งคืนงาน' : `ส่งแจ้งคืนงาน (${picked.length} รายการ)`}
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">เจ้าหน้าที่จะตรวจนับของจริงแล้วยืนยันอีกครั้ง</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── สรุปจำนวนงานที่ตัด — รอบตัดค่าแรงปัจจุบัน พร้อมยอดเงินโดยประมาณ (ใช้ค่าเดียวกับหน้าหลัก คำนวณจากรายการที่ยืนยัน+คืนแล้วเท่านั้น) ── */
function CuttingSummaryScreen({ token, member, wage, onCancel }: { token: string; member: any; wage: number; onCancel: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cutting-summary', token],
    queryFn: () => portalApi.cuttingSummary(token),
  });
  const [exporting, setExporting] = useState(false);

  const rows: any[] = data?.rows || [];
  const products: any[] = data?.products || [];
  const dates = Array.from(new Set(rows.map((r: any) => r.issued_at))).sort();
  const qtyOf = (date: string, productId: number) => {
    const r = rows.find((x: any) => x.issued_at === date && x.product_id === productId);
    return r ? Number(r.good_qty) || 0 : 0;
  };
  const totalOf = (productId: number) => rows.filter((r: any) => r.product_id === productId).reduce((s: number, r: any) => s + (Number(r.good_qty) || 0), 0);
  // ยอดเงินต่อสินค้า — รวมจาก r.wage ของแต่ละแถว (คำนวณจากรายการที่ยืนยัน+คืนแล้วเท่านั้น สูตรเดียวกับยอดรวมด้านบน)
  const wageOf = (productId: number) => rows.filter((r: any) => r.product_id === productId).reduce((s: number, r: any) => s + (Number(r.wage) || 0), 0);
  const grandTotal = rows.reduce((s: number, r: any) => s + (Number(r.good_qty) || 0), 0);
  const unit = products[0]?.unit || '';

  // สร้างรายงาน PDF จริง (ไม่ใช่ถ่ายภาพหน้าจอ) — วางหน้ากระดาษ, หัวเรื่อง, การ์ดสรุป และตารางเองด้วย jsPDF + autoTable
  // ฝังฟอนต์ไทย Sarabun เพื่อให้ตัวอักษรคมชัดและค้นหา/เลือกข้อความในไฟล์ได้ ไม่ใช่ภาพแรสเตอร์
  const exportPdf = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      registerSarabunFont(doc);
      // เพิ่มระยะบรรทัดจากค่าเริ่มต้น (1.15) ให้สระ/วรรณยุกต์ไทยที่ซ้อนกันมีที่หายใจ ไม่ดูอัดแน่น
      doc.setLineHeightFactor(1.4);

      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;

      doc.setFont('Sarabun', 'bold'); doc.setFontSize(19); doc.setTextColor(32, 31, 28);
      doc.text('สรุปยอดตัดสายไฟ', margin, margin + 5);
      doc.setFont('Sarabun', 'normal'); doc.setFontSize(12.5); doc.setTextColor(90, 86, 78);
      doc.text(`${member?.name || ''}${member?.code ? ` (รหัส ${member.code})` : ''}`, margin, margin + 12.5);
      doc.setFontSize(10.5); doc.setTextColor(150, 145, 135);
      doc.text(`รอบ ${fmtDate(data.start)} - ${fmtDate(data.end)}`, margin, margin + 18.5);

      const boxY = margin + 25;
      const boxHeight = 24;
      const boxGap = 6;
      const boxWidth = (pageWidth - margin * 2 - boxGap) / 2;

      doc.setFillColor(243, 232, 255);
      doc.roundedRect(margin, boxY, boxWidth, boxHeight, 3, 3, 'F');
      doc.setFont('Sarabun', 'normal'); doc.setFontSize(11); doc.setTextColor(91, 33, 182);
      doc.text('ตัดไปแล้วรวมรอบนี้', margin + boxWidth / 2, boxY + 9, { align: 'center' });
      doc.setFont('Sarabun', 'bold'); doc.setFontSize(19);
      doc.text(`${fmtQty(grandTotal)} ${unit}`, margin + boxWidth / 2, boxY + 18, { align: 'center' });

      const boxBX = margin + boxWidth + boxGap;
      doc.setFillColor(209, 250, 229);
      doc.roundedRect(boxBX, boxY, boxWidth, boxHeight, 3, 3, 'F');
      doc.setFont('Sarabun', 'normal'); doc.setFontSize(11); doc.setTextColor(4, 120, 87);
      doc.text('คิดเป็นเงินประมาณ (ไม่เป็นทางการ)', boxBX + boxWidth / 2, boxY + 9, { align: 'center' });
      doc.setFont('Sarabun', 'bold'); doc.setFontSize(19);
      doc.text(fmtMoneyForPdf(wage), boxBX + boxWidth / 2, boxY + 18, { align: 'center' });

      const head = [['วันที่เบิก', ...products.map((p: any) => {
        const { num, label } = parseProductLabel(p.name);
        return `${num}\n${label}`;
      })]];
      const body = dates.map((d: string) => [fmtDate(d), ...products.map((p: any) => {
        const q = qtyOf(d, p.id);
        return q > 0 ? fmtQty(q) : '-';
      })]);
      const foot = [
        ['รวม', ...products.map((p: any) => fmtQty(totalOf(p.id)))],
        ['คิดเป็นเงิน', ...products.map((p: any) => fmtMoneyForPdf(wageOf(p.id)))],
      ];

      autoTable(doc, {
        startY: boxY + boxHeight + 8,
        head, body, foot,
        theme: 'grid',
        margin: { left: margin, right: margin },
        styles: { font: 'Sarabun', fontSize: 10.5, cellPadding: 3, halign: 'center', valign: 'middle', lineColor: [232, 228, 220], lineWidth: 0.2, textColor: [32, 31, 28] },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fontSize: 10.5, fillColor: [248, 247, 244], textColor: [90, 86, 78], cellPadding: { top: 6.5, right: 2, bottom: 2.5, left: 2 } },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
        didParseCell: (d) => {
          if (d.section === 'foot') {
            if (d.row.index === 0) { d.cell.styles.fillColor = [243, 232, 255]; d.cell.styles.textColor = [91, 33, 182]; }
            else { d.cell.styles.fillColor = [209, 250, 229]; d.cell.styles.textColor = [4, 120, 87]; }
            d.cell.styles.fontStyle = 'bold';
          }
        },
        // จุดสีแสดงสินค้าตรงหัวคอลัมน์ (ขาว/ชมพู/เขียว ฯลฯ) ให้ตรงกับหน้าจอจริง — ใช้ 'FD' (fill+draw) กันจุดสีขาวจมหายไปกับพื้นหลัง
        didDrawCell: (d) => {
          if (d.section === 'head' && d.column.index > 0) {
            const p = products[d.column.index - 1];
            if (p?.color) {
              const [r, g, b] = hexToRgb(p.color);
              doc.setFillColor(r, g, b);
              doc.setDrawColor(200, 196, 188);
              doc.circle(d.cell.x + d.cell.width / 2, d.cell.y + 3.2, 1.2, 'FD');
            }
          }
        },
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFont('Sarabun', 'normal'); doc.setFontSize(9); doc.setTextColor(165, 160, 153);
          doc.text(`พิมพ์เมื่อ ${fmtDate(todayLocal())} · ไม่เป็นทางการ`, margin, pageHeight - 8);
          doc.text(`หน้า ${(doc as any).internal.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
        },
      });

      doc.save(`สรุปยอด-${member?.code || 'สมาชิก'}${data?.cycle ? `-${data.cycle}` : ''}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-lg text-gray-800">สรุปยอด</p>
          {data && <p className="text-xs text-gray-400">รอบ {fmtDate(data.start)} - {fmtDate(data.end)}</p>}
        </div>
        {rows.length > 0 && (
          <button onClick={exportPdf} disabled={exporting} className="p-2.5 rounded-full hover:bg-gray-100 text-gray-500 shrink-0 disabled:opacity-50" title="ดาวน์โหลดเป็น PDF">
            {exporting ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
          </button>
        )}
      </div>

      <div className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400">
            <ClipboardList size={32} className="mx-auto mb-2 opacity-50" />
            ยังไม่มีข้อมูลการตัดในรอบนี้
          </div>
        ) : (
          <>
            <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-5 text-center">
              <p className="text-sm text-purple-700 font-medium">ตัดไปแล้วรวมรอบนี้</p>
              <p className="text-4xl font-bold text-purple-800 mt-1">{fmtQty(grandTotal)} <span className="text-lg font-normal">{unit}</span></p>
              <div className="mt-3 pt-3 border-t border-purple-200/70 flex items-center justify-center gap-1.5 flex-wrap">
                <span className="text-sm text-emerald-700 font-medium">คิดเป็นเงินประมาณ</span>
                <span className="text-lg font-bold text-emerald-700">{money(wage)}</span>
                <span className="text-xs text-gray-400">(ไม่เป็นทางการ)</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-500 border-r whitespace-nowrap">วันที่เบิก</th>
                    {products.map((p: any) => {
                      const { num, label } = parseProductLabel(p.name);
                      return (
                        <th key={p.id} className="px-2.5 py-2 text-center font-medium text-gray-500 min-w-[64px]">
                          <span className="flex items-center justify-center gap-1 text-gray-700 font-bold">
                            {p.color && <span className="w-2 h-2 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                            {num}
                          </span>
                          <span className="block text-[10px] font-normal leading-tight mt-0.5">{label}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((d: string) => (
                    <tr key={d} className="border-b border-gray-50 last:border-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-gray-700 whitespace-nowrap border-r">{fmtDate(d)}</td>
                      {products.map((p: any) => {
                        const q = qtyOf(d, p.id);
                        return <td key={p.id} className="px-2.5 py-2 text-center tabular-nums text-gray-700">{q > 0 ? fmtQty(q) : '-'}</td>;
                      })}
                    </tr>
                  ))}
                  <tr className="bg-purple-50 font-bold">
                    <td className="sticky left-0 z-10 bg-purple-50 px-3 py-2 text-purple-800 border-r">รวม</td>
                    {products.map((p: any) => (
                      <td key={p.id} className="px-2.5 py-2 text-center tabular-nums text-purple-800">{fmtQty(totalOf(p.id))}</td>
                    ))}
                  </tr>
                  <tr className="bg-emerald-50 font-bold">
                    <td className="sticky left-0 z-10 bg-emerald-50 px-3 py-2 text-emerald-700 border-r whitespace-nowrap">คิดเป็นเงิน</td>
                    {products.map((p: any) => (
                      <td key={p.id} className="px-2.5 py-2 text-center tabular-nums text-emerald-700 whitespace-nowrap">{money(wageOf(p.id))}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-center text-xs text-gray-400">ปัดขวาเพื่อดูสินค้าชนิดอื่น</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function MemberPortal() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const [requestingIssue, setRequestingIssue] = useState(false);
  const [showReturnList, setShowReturnList] = useState(false);
  const [showCuttingSummary, setShowCuttingSummary] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState<'return' | 'issue' | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => portalApi.get(token!),
    enabled: !!token,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['portal', token] });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 size={32} className="animate-spin text-blue-500" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div>
          <p className="text-2xl mb-2">😕</p>
          <p className="text-lg font-semibold text-gray-700">ไม่พบข้อมูล</p>
          <p className="text-sm text-gray-500 mt-1">ลิงก์นี้อาจไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่</p>
        </div>
      </div>
    );
  }

  if (requestingIssue) {
    return (
      <IssueRequestScreen
        token={token!}
        products={data.products || []}
        onCancel={() => setRequestingIssue(false)}
        onDone={() => { setRequestingIssue(false); setJustSubmitted('issue'); refresh(); setTimeout(() => setJustSubmitted(null), 4000); }}
      />
    );
  }

  if (showReturnList) {
    return (
      <ReturnListScreen
        token={token!}
        openIssues={data.open_issues || []}
        onCancel={() => setShowReturnList(false)}
        onDone={() => { setShowReturnList(false); setJustSubmitted('return'); refresh(); setTimeout(() => setJustSubmitted(null), 4000); }}
      />
    );
  }

  if (showCuttingSummary) {
    return <CuttingSummaryScreen token={token!} member={data.member} wage={data.current_cycle?.wage || 0} onCancel={() => setShowCuttingSummary(false)} />;
  }

  const { member, recent_requests, recent_issue_requests } = data;
  const cc = data.current_cycle || { total_qty: 0, wage: 0, breakdown: [] as any[] };
  const openReturnable = (data.open_issues || []).filter((i: any) => i.remaining > 0).length;
  const initial = (member.nickname || member.name || '?').trim().charAt(0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="relative overflow-hidden px-5 pt-8 pb-8 shrink-0 bg-[radial-gradient(130%_150%_at_15%_-20%,#6a3fae_0%,#4a2f8c_46%,#262459_100%)]">
        <div className="absolute -right-16 -top-24 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-24 w-48 h-48 rounded-full bg-white/[0.06] blur-2xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/60 text-sm">{greetingText()} 👋</p>
            <h1 className="text-2xl font-bold text-white mt-0.5 truncate">
              {member.name}
              {member.nickname && <span className="text-base font-normal text-white/70"> ({member.nickname})</span>}
            </h1>
            <span className="inline-flex mt-2.5 px-3 py-1 rounded-full bg-white/[0.14] border border-white/20 text-white/85 text-xs font-semibold">รหัสสมาชิก {member.code}</span>
          </div>
          <div className="shrink-0 w-[52px] h-[52px] rounded-full bg-white/[0.12] border border-white/20 grid place-items-center text-white font-bold text-lg">
            {initial}
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 w-full">
        {/* การ์ดรายได้โดยประมาณ — ลอยคาบรอยต่อหัวบล็อกกับเนื้อหา */}
        <div className="relative -mt-[30px] bg-white rounded-[22px] shadow-lg border border-gray-100 pt-3 px-[18px] pb-4">
          <div className="flex flex-col items-center text-center">
            <p className="text-xs font-medium text-gray-500">ประมาณการรายได้ถึงปัจจุบัน (ไม่เป็นทางการ)</p>
            <div className="relative flex items-center justify-center w-full mt-1.5 min-h-[40px]">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-[13px] grid place-items-center bg-[conic-gradient(from_200deg,#4fd39f,#0f8f6d,#4fd39f)]">
                <div className="absolute inset-[3px] rounded-[10px] bg-white" />
                <span className="relative text-emerald-700 font-bold text-[19px]">฿</span>
              </div>
              <p className="text-[32px] font-medium text-emerald-700 tracking-tight leading-none">{money(cc.wage)}</p>
            </div>
            <p className="text-xs text-gray-500 mt-2">จากงานที่ตัด {fmtQty(cc.total_qty)} เส้น{cc.start && ` (${fmtDate(cc.start)} – ${fmtDate(cc.end)})`}</p>
          </div>
        </div>
      </div>

      {/* ปุ่มหลัก — เรียงตามแนวนอน (ไอคอน+ตัวหนังสือชิดกันในแถวเดียว) เรียงต่อกันจากบนลงล่าง แถวใหญ่กดง่าย เหมาะกับผู้สูงอายุ */}
      <div className="max-w-md mx-auto px-4 pt-6 w-full">
        {justSubmitted && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3 mb-4 shadow-sm">
            <CheckCircle2 size={28} className="text-green-600 shrink-0" />
            <p className="text-green-800 font-semibold">
              {justSubmitted === 'issue' ? 'ส่งคำขอเบิกงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ' : 'ส่งแจ้งคืนงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ'}
            </p>
          </div>
        )}

        <p className="text-xs font-bold tracking-wider uppercase text-gray-400 mb-2.5 px-1">เมนูหลัก</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setRequestingIssue(true)}
            className="w-full bg-white border border-gray-100 hover:border-blue-300 active:scale-[0.98] transition-all rounded-3xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md text-left"
          >
            <div className="p-3.5 bg-blue-50 rounded-2xl shrink-0"><PackagePlus size={28} className="text-blue-600" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-lg">เบิกงาน</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">แจ้งขอเบิกวัตถุดิบไปตัดเพิ่ม</p>
            </div>
            <ChevronRight size={18} className="text-gray-300 shrink-0" />
          </button>
          <button
            onClick={() => setShowReturnList(true)}
            className="w-full bg-white border border-gray-100 hover:border-green-300 active:scale-[0.98] transition-all rounded-3xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md text-left"
          >
            <div className="p-3.5 bg-green-50 rounded-2xl shrink-0"><RotateCcw size={28} className="text-green-600" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-lg">คืนงาน</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">ส่งงานที่ตัดเสร็จแล้วคืน</p>
            </div>
            {openReturnable > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 shrink-0 whitespace-nowrap">{openReturnable} ใบรอคืน</span>
            )}
          </button>
          <button
            onClick={() => setShowCuttingSummary(true)}
            className="w-full bg-white border border-gray-100 hover:border-purple-300 active:scale-[0.98] transition-all rounded-3xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md text-left"
          >
            <div className="p-3.5 bg-purple-50 rounded-2xl shrink-0"><ClipboardList size={28} className="text-purple-600" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-lg">สรุปยอด</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">ดูยอดที่ตัดไปในรอบนี้</p>
            </div>
            {cc.total_qty > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 shrink-0 whitespace-nowrap">{fmtQty(cc.total_qty)} เส้น</span>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pb-10 w-full space-y-4 shrink-0">
        {recent_requests?.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-500 px-1 mb-2 mt-6">ประวัติการแจ้งคืนล่าสุด</p>
            <div className="bg-white rounded-2xl border divide-y">
              {recent_requests.map((r: any) => {
                const st = statusInfo[r.status] || statusInfo.pending;
                const Icon = st.icon;
                return (
                  <div key={r.id} className="p-3.5 flex items-center gap-3">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{r.product_name}</p>
                      <p className="text-xs text-gray-400">{fmtDate(r.submitted_at)} · แจ้งดี {fmtQty(r.good_qty)} {r.unit}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${st.cls}`}>
                      <Icon size={12} /> {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {recent_issue_requests?.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-500 px-1 mb-2 mt-6">ประวัติคำขอเบิกงานล่าสุด</p>
            <div className="bg-white rounded-2xl border divide-y">
              {recent_issue_requests.map((r: any) => {
                const st = statusInfo[r.status] || statusInfo.pending;
                const Icon = st.icon;
                return (
                  <div key={r.id} className="p-3.5 flex items-center gap-3">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{r.product_name}</p>
                      <p className="text-xs text-gray-400">{fmtDate(r.submitted_at)} · ขอเบิก {fmtQty(r.quantity)} {r.unit}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${st.cls}`}>
                      <Icon size={12} /> {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
