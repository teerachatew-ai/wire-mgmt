import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../api';
import { CheckCircle2, Clock, XCircle, PackageOpen, ArrowLeft, Send, Loader2, PackagePlus, ChevronRight, ChevronDown, RotateCcw } from 'lucide-react';

const fmtQty = (n: number) => Number(n || 0).toLocaleString('th-TH');
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

/* ── ฟอร์มแจ้งคืนงาน (เต็มจอ ทีละขั้นตอน ปุ่มใหญ่ กดง่าย) ── */
function ReturnForm({ token, issue, onDone, onCancel }: { token: string; issue: any; onDone: () => void; onCancel: () => void }) {
  const [good, setGood] = useState('');
  const [hasProblem, setHasProblem] = useState(false);
  const [ngCut, setNgCut] = useState('');
  const [ngFactory, setNgFactory] = useState('');
  const [lost, setLost] = useState('');
  const [returnedAt, setReturnedAt] = useState(new Date().toISOString().split('T')[0]);
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
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().split('T')[0]);
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

export default function MemberPortal() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const [activeIssue, setActiveIssue] = useState<any>(null);
  const [requestingIssue, setRequestingIssue] = useState(false);
  const [showReturnList, setShowReturnList] = useState(false);
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

  const { member, recent_requests, recent_issue_requests } = data;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-blue-600 text-white px-5 pt-8 pb-6 rounded-b-[2rem] shrink-0">
        <p className="text-blue-100 text-sm">สวัสดี 👋</p>
        <h1 className="text-2xl font-bold">
          {member.name}
          {member.nickname && <span className="text-lg font-normal"> ({member.nickname})</span>}
        </h1>
        <p className="text-blue-100 text-sm mt-0.5">รหัสสมาชิก {member.code}</p>
      </div>

      {/* ปุ่มหลัก 2 ปุ่ม — ขยายเต็มพื้นที่หน้าจอที่เหลือ (โดยเฉพาะมือถือ) ให้กดง่ายที่สุด */}
      <div className="flex-1 flex flex-col max-w-md mx-auto px-4 -mt-3 w-full">
        {justSubmitted && (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 flex items-center gap-3 mb-4">
            <CheckCircle2 size={28} className="text-green-600 shrink-0" />
            <p className="text-green-800 font-semibold">
              {justSubmitted === 'issue' ? 'ส่งคำขอเบิกงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ' : 'ส่งแจ้งคืนงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 flex-1 min-h-[calc(100vh-150px)] pb-4">
          <button
            onClick={() => setRequestingIssue(true)}
            className="bg-white border-2 border-blue-200 hover:border-blue-400 active:scale-[0.98] transition-transform rounded-3xl flex flex-col items-center justify-center gap-4"
          >
            <div className="p-6 bg-blue-100 rounded-2xl"><PackagePlus size={56} className="text-blue-600" /></div>
            <p className="font-bold text-gray-800 text-3xl">เบิกงาน</p>
          </button>
          <button
            onClick={() => setShowReturnList(true)}
            className="bg-white border-2 border-green-200 hover:border-green-400 active:scale-[0.98] transition-transform rounded-3xl flex flex-col items-center justify-center gap-4"
          >
            <div className="p-6 bg-green-100 rounded-2xl"><RotateCcw size={56} className="text-green-600" /></div>
            <p className="font-bold text-gray-800 text-3xl">คืนงาน</p>
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
