import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../api';
import { CheckCircle2, Clock, XCircle, PackageOpen, ArrowLeft, Send, Loader2, PackagePlus, ChevronRight } from 'lucide-react';

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

/* ── ฟอร์มแจ้งคืนงาน (เต็มจอ ทีละขั้นตอน ปุ่มใหญ่ กดง่าย) ── */
function ReturnForm({ token, issue, onDone, onCancel }: { token: string; issue: any; onDone: () => void; onCancel: () => void }) {
  const [good, setGood] = useState('');
  const [hasProblem, setHasProblem] = useState(false);
  const [ngCut, setNgCut] = useState('');
  const [waste, setWaste] = useState('');
  const [lost, setLost] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => portalApi.submitReturn(token, {
      issue_id: issue.id,
      good_qty: good || 0,
      ng_cut: ngCut || 0,
      waste_qty: waste || 0,
      lost_qty: lost || 0,
    }),
    onSuccess: onDone,
    onError: (e: any) => setError(e.response?.data?.error || 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'),
  });

  const total = (parseFloat(good) || 0) + (parseFloat(ngCut) || 0) + (parseFloat(waste) || 0) + (parseFloat(lost) || 0);

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
            มีของเสีย / เศษ / ของหายไหม?
          </button>
        ) : (
          <div className="bg-white rounded-2xl border p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-600">มีปัญหาด้วย — ระบุจำนวน (ใส่เฉพาะที่มี)</p>
            <div>
              <label className="text-sm text-gray-500">เสียจากการตัด (เส้น)</label>
              <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={ngCut} onChange={e => setNgCut(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-500">เศษ (เส้น)</label>
              <input type="number" inputMode="numeric" min={0} className="input mt-1" placeholder="0" value={waste} onChange={e => setWaste(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-500">ของหาย (เส้น)</label>
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

/* ── เลือกสินค้าที่จะขอเบิก (การ์ดใหญ่ กดง่าย) ── */
function ProductPicker({ products, onPick, onCancel }: { products: any[]; onPick: (p: any) => void; onCancel: () => void }) {
  const groups = Object.values(
    (products || []).reduce((acc: any, p: any) => {
      const key = p.project || 'สินค้า';
      (acc[key] ??= { key, products: [] }).products.push(p);
      return acc;
    }, {})
  ) as any[];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <p className="font-bold text-lg text-gray-800">เลือกสินค้าที่จะเบิก</p>
      </div>
      <div className="flex-1 p-4 space-y-5 max-w-md mx-auto w-full">
        {groups.length === 0 && (
          <div className="bg-white rounded-2xl border p-6 text-center text-gray-400">ยังไม่มีสินค้าให้เลือก ติดต่อเจ้าหน้าที่</div>
        )}
        {groups.map((g: any) => (
          <div key={g.key}>
            {g.key !== 'สินค้า' && <p className="text-sm font-semibold text-gray-500 px-1 mb-2">{g.key}</p>}
            <div className="space-y-2">
              {g.products.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => onPick(p)}
                  className="w-full bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-300 active:scale-[0.98] transition-transform p-4 flex items-center gap-3 text-left"
                >
                  {p.color && <span className="w-6 h-6 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                  <span className="flex-1 font-semibold text-gray-800">{p.name}</span>
                  <ChevronRight size={20} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── ฟอร์มขอเบิกงาน (เลือกสินค้าแล้ว กรอกจำนวนที่ต้องการ) ── */
function IssueRequestForm({ token, product, onDone, onCancel }: { token: string; product: any; onDone: () => void; onCancel: () => void }) {
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => portalApi.submitIssue(token, { product_id: product.id, quantity: qty || 0 }),
    onSuccess: onDone,
    onError: (e: any) => setError(e.response?.data?.error || 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'),
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-2 -ml-2 rounded-full hover:bg-gray-100"><ArrowLeft size={24} /></button>
        <div className="min-w-0 flex items-center gap-2">
          {product.color && <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: product.color }} />}
          <p className="font-bold text-lg text-gray-800 truncate">{product.name}</p>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5 max-w-md mx-auto w-full">
        <div className="bg-white rounded-3xl border-2 border-blue-200 p-5 text-center">
          <label className="block text-lg font-semibold text-gray-700 mb-3">ขอเบิกกี่{product.unit || 'เส้น'}?</label>
          <input
            type="number" inputMode="numeric" min={0} autoFocus
            className="w-full text-center text-5xl font-bold text-blue-700 border-b-4 border-blue-200 focus:border-blue-500 outline-none py-2 bg-transparent"
            placeholder="0"
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
          <p className="text-sm text-gray-400 mt-2">{product.unit}</p>
        </div>

        {error && <p className="text-rose-600 text-sm text-center font-medium">{error}</p>}

        <button
          type="button"
          disabled={(parseFloat(qty) || 0) <= 0 || mut.isPending}
          onClick={() => mut.mutate()}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 disabled:bg-gray-300 text-white font-bold text-xl py-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
        >
          {mut.isPending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />}
          ส่งคำขอเบิกงาน
        </button>
        <p className="text-center text-xs text-gray-400">เจ้าหน้าที่จะตรวจสอบแล้วอนุมัติอีกครั้ง</p>
      </div>
    </div>
  );
}

export default function MemberPortal() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const [activeIssue, setActiveIssue] = useState<any>(null);
  const [pickingProduct, setPickingProduct] = useState(false);
  const [issueProduct, setIssueProduct] = useState<any>(null);
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
        onDone={() => { setActiveIssue(null); setJustSubmitted('return'); refresh(); setTimeout(() => setJustSubmitted(null), 4000); }}
      />
    );
  }

  if (issueProduct) {
    return (
      <IssueRequestForm
        token={token!}
        product={issueProduct}
        onCancel={() => setIssueProduct(null)}
        onDone={() => { setIssueProduct(null); setJustSubmitted('issue'); refresh(); setTimeout(() => setJustSubmitted(null), 4000); }}
      />
    );
  }

  if (pickingProduct) {
    return (
      <ProductPicker
        products={data.products || []}
        onCancel={() => setPickingProduct(false)}
        onPick={(p) => { setPickingProduct(false); setIssueProduct(p); }}
      />
    );
  }

  const { member, open_issues, recent_requests, recent_issue_requests } = data;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="bg-blue-600 text-white px-5 pt-8 pb-6 rounded-b-[2rem]">
        <p className="text-blue-100 text-sm">สวัสดี 👋</p>
        <h1 className="text-2xl font-bold">{member.nickname || member.name}</h1>
        <p className="text-blue-100 text-sm mt-0.5">รหัสสมาชิก {member.code}</p>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-3 space-y-4">
        {justSubmitted && (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 size={28} className="text-green-600 shrink-0" />
            <p className="text-green-800 font-semibold">
              {justSubmitted === 'issue' ? 'ส่งคำขอเบิกงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ' : 'ส่งแจ้งคืนงานแล้ว ✅ รอเจ้าหน้าที่ตรวจสอบ'}
            </p>
          </div>
        )}

        <button
          onClick={() => setPickingProduct(true)}
          className="w-full bg-white border-2 border-blue-200 hover:border-blue-400 active:scale-[0.98] transition-transform rounded-2xl p-4 flex items-center gap-3 mt-4"
        >
          <div className="p-2.5 bg-blue-100 rounded-xl shrink-0"><PackagePlus size={24} className="text-blue-600" /></div>
          <div className="flex-1 text-left">
            <p className="font-bold text-gray-800">ขอเบิกงานเพิ่ม</p>
            <p className="text-xs text-gray-500">แจ้งเจ้าหน้าที่ว่าอยากเบิกงานเพิ่ม</p>
          </div>
          <ChevronRight size={20} className="text-gray-300 shrink-0" />
        </button>

        <div>
          <p className="text-sm font-semibold text-gray-500 px-1 mb-2 mt-4">งานที่ยังเบิกค้างอยู่</p>
          {open_issues.length === 0 ? (
            <div className="bg-white rounded-2xl border p-6 text-center text-gray-400">
              <PackageOpen size={32} className="mx-auto mb-2 opacity-50" />
              ตอนนี้ไม่มีงานค้างเบิก
            </div>
          ) : (
            <div className="space-y-3">
              {open_issues.map((i: any) => (
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
                      onClick={() => setActiveIssue(i)}
                      className="bg-blue-600 disabled:bg-gray-300 text-white font-bold px-5 py-3 rounded-xl active:scale-[0.97] transition-transform"
                    >
                      คืนงาน
                    </button>
                  </div>
                  {i.pending_total > 0 && (
                    <p className="text-xs text-amber-600 mt-2">🕐 มีคำขอรอตรวจสอบอยู่ {fmtQty(i.pending_total)} {i.unit}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

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
