import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../api';
import { CheckCircle2, Clock, XCircle, PackageOpen, ArrowLeft, Send, Loader2, PackagePlus, ChevronRight, ChevronDown, RotateCcw, ClipboardList } from 'lucide-react';

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

/* ── ฟอร์มแจ้งคืนงาน (เต็มจอ ทีละขั้นตอน ปุ่มใหญ่ กดง่าย) ── */
function ReturnForm({ token, issue, onDone, onCancel }: { token: string; issue: any; onDone: () => void; onCancel: () => void }) {
  const [good, setGood] = useState('');
  const [hasProblem, setHasProblem] = useState(false);
  const [ngCut, setNgCut] = useState('');
  const [ngFactory, setNgFactory] = useState('');
  const [lost, setLost] = useState('');
  const [returnedAt, setReturnedAt] = useState(todayLocal());
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => portalApi.submitReturn(token, {
      issue_id: issue.id,
      good_qty: good || 0,
      ng_cut: ngCut || 0,
      ng_factory: ngFactory || 0,
      lost_qty: lost || 0,
      returned_at: returnedAt,
    }),
    onSuccess: onDone,
    onError: (e: any) => setError(e.response?.data?.error || 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'),
  });

  const total = (parseFloat(good) || 0) + (parseFloat(ngCut) || 0) + (parseFloat(ngFactory) || 0) + (parseFloat(lost) || 0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <div className="min-w-0">
          <p className="font-bold text-lg text-gray-800 truncate">{issue.product_name}</p>
          <p className="text-sm text-gray-500">เบิกไป {fmtQty(issue.quantity)} {issue.unit} · คงเหลือ {fmtQty(issue.remaining)} {issue.unit}</p>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5 max-w-md mx-auto w-full">
        <div className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-gray-600 shrink-0">วันที่คืน</label>
          <input type="date" className="input !w-auto text-right" value={returnedAt} onChange={e => setReturnedAt(e.target.value)} />
        </div>

        <div className="bg-white rounded-3xl border-2 border-blue-200 p-5 text-center">
          <label className="block text-lg font-semibold text-gray-700 mb-3">ตัดเสร็จแล้วกี่เส้น?</label>
          <input
            type="number" inputMode="numeric" min={0} autoFocus
            className="w-full text-center text-5xl font-bold text-blue-700 border-b-4 border-blue-200 focus:border-blue-500 outline-none py-2 bg-transparent"
            placeholder="0"
            value={good}
            onChange={e => setGood(e.target.value)}
          />
          <p className="text-sm text-gray-400 mt-2">{issue.unit}</p>
        </div>

        {!hasProblem ? (
          <button
            type="button"
            onClick={() => setHasProblem(true)}
            className="w-full text-center text-gray-500 text-base py-2 underline"
          >
            มีของเสีย / ของหายไหม?
          </button>
        ) : (
          <div className="bg-white rounded-2xl border p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-600">มีปัญหาด้วย — ระบุจำนวน (ใส่เฉพาะที่มี)</p>
            <div>
              <label className="text-sm text-gray-500">จำนวนงานเสียจากการตัด (เส้น)</label>
              <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={ngCut} onChange={e => setNgCut(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-500">จำนวนงานเสียจากโรงงาน (เส้น)</label>
              <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={ngFactory} onChange={e => setNgFactory(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-500">จำนวนงานหาย (เส้น)</label>
              <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={lost} onChange={e => setLost(e.target.value)} />
            </div>
          </div>
        )}

        {total > issue.remaining + 0.001 && (
          <p className="text-rose-600 text-sm text-center font-medium">⚠️ รวมแล้วเกินจำนวนที่เบิกไป (คงเหลือ {fmtQty(issue.remaining)} {issue.unit})</p>
        )}
        {error && <p className="text-rose-600 text-sm text-center font-medium">{error}</p>}

        <button
          type="button"
          disabled={total <= 0 || total > issue.remaining + 0.001 || mut.isPending}
          onClick={() => mut.mutate()}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 disabled:bg-gray-300 text-white font-bold text-xl py-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
        >
          {mut.isPending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />}
          ส่งแจ้งคืนงาน
        </button>
        <p className="text-center text-xs text-gray-400">เจ้าหน้าที่จะตรวจนับของจริงแล้วยืนยันอีกครั้ง</p>
      </div>
    </div>
  );
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

/* ── คืนงาน — รายการงานค้างเบิก กดเข้ามาถึงเห็น (หน้าแรกไม่โชว์รายละเอียด) ── */
function ReturnListScreen({ openIssues, onSelect, onCancel }: { openIssues: any[]; onSelect: (i: any) => void; onCancel: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
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
          openIssues.map((i: any) => (
            <div key={i.id} className="bg-white rounded-2xl border p-4">
              <div className="flex items-center gap-2">
                {i.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: i.color }} />}
                <p className="font-bold text-gray-800">{i.product_name}</p>
              </div>
              <p className="text-sm text-gray-500 mt-1">เบิกเมื่อ {fmtDate(i.issued_at)} · เบิกไป {fmtQty(i.quantity)} {i.unit}</p>
              <div className="flex items-center justify-between mt-3">
                <div>
                  <p className="text-xs text-gray-400">คงเหลือที่ต้องคืน</p>
                  <p className="text-xl font-bold text-blue-700">{fmtQty(i.remaining)} <span className="text-sm font-normal text-gray-400">{i.unit}</span></p>
                </div>
                <button
                  disabled={i.remaining <= 0}
                  onClick={() => onSelect(i)}
                  className="bg-blue-600 disabled:bg-gray-300 text-white font-bold px-5 py-3 rounded-xl active:scale-[0.97] transition-transform"
                >
                  คืนงาน
                </button>
              </div>
              {i.pending_total > 0 && (
                <p className="text-xs text-amber-600 mt-2">🕐 มีคำขอรอตรวจสอบอยู่ {fmtQty(i.pending_total)} {i.unit}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── สรุปจำนวนงานที่ตัด — รอบตัดค่าแรงปัจจุบัน ไม่แสดงจำนวนเงิน ── */
function CuttingSummaryScreen({ token, onCancel }: { token: string; onCancel: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cutting-summary', token],
    queryFn: () => portalApi.cuttingSummary(token),
  });

  const rows: any[] = data?.rows || [];
  const products: any[] = data?.products || [];
  const dates = Array.from(new Set(rows.map((r: any) => r.issued_at))).sort();
  const qtyOf = (date: string, productId: number) => {
    const r = rows.find((x: any) => x.issued_at === date && x.product_id === productId);
    return r ? Number(r.good_qty) || 0 : 0;
  };
  const totalOf = (productId: number) => rows.filter((r: any) => r.product_id === productId).reduce((s: number, r: any) => s + (Number(r.good_qty) || 0), 0);
  const grandTotal = rows.reduce((s: number, r: any) => s + (Number(r.good_qty) || 0), 0);
  const unit = products[0]?.unit || '';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <div className="min-w-0">
          <p className="font-bold text-lg text-gray-800">สรุปยอด</p>
          {data && <p className="text-xs text-gray-400">รอบ {fmtDate(data.start)} - {fmtDate(data.end)}</p>}
        </div>
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
  const [activeIssue, setActiveIssue] = useState<any>(null);
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

  if (activeIssue) {
    return (
      <ReturnForm
        token={token!}
        issue={activeIssue}
        onCancel={() => setActiveIssue(null)}
        onDone={() => { setActiveIssue(null); setShowReturnList(false); setJustSubmitted('return'); refresh(); setTimeout(() => setJustSubmitted(null), 4000); }}
      />
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
        openIssues={data.open_issues || []}
        onCancel={() => setShowReturnList(false)}
        onSelect={(i) => setActiveIssue(i)}
      />
    );
  }

  if (showCuttingSummary) {
    return <CuttingSummaryScreen token={token!} onCancel={() => setShowCuttingSummary(false)} />;
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
            <p className="text-xs font-medium text-gray-500">ประมาณการรายได้ถึงปัจจุบัน</p>
            <div className="relative flex items-center justify-center w-full mt-1.5 min-h-[40px]">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-[13px] grid place-items-center bg-[conic-gradient(from_200deg,#4fd39f,#0f8f6d,#4fd39f)]">
                <div className="absolute inset-[3px] rounded-[10px] bg-white" />
                <span className="relative text-emerald-700 font-bold text-[19px]">฿</span>
              </div>
              <p className="text-[32px] font-medium text-emerald-700 tracking-tight leading-none">{money(cc.wage)}</p>
            </div>
            <p className="text-xs text-gray-500 mt-2">จากงานที่ตัด {fmtQty(cc.total_qty)} เส้น{cc.start && ` (${fmtDate(cc.start)} – ${fmtDate(cc.end)})`}</p>
          </div>
          {cc.breakdown.length > 0 && (
            <div className="flex items-center justify-center gap-2.5 mt-3 pt-3 border-t border-gray-100 flex-nowrap overflow-x-auto">
              {cc.breakdown.map((b: any) => (
                <span key={b.project} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 whitespace-nowrap">
                  {b.color && <span className="w-2 h-2 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: b.color }} />}
                  {b.label} <b className="text-gray-800">{fmtQty(b.sets)}</b> ชุด
                </span>
              ))}
            </div>
          )}
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
