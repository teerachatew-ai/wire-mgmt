import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ngPhotoApi, memberApi, productApi } from '../api';
import MemberSelect from '../components/MemberSelect';
import { Image as Images, X, Download, Trash2, Save, Loader2, Link2, Unlink, MessageCircle, ImageOff } from 'lucide-react';

/* อัลบั้มรูปงาน NG — รูปมาจากกลุ่มไลน์ตัดสายไฟ (สมาชิกส่งรูป + พิมพ์ "NG" → บอทเก็บเข้าที่นี่ให้เอง)
   ทุกรูปถูกประทับ รุ่น / ผู้ส่ง / วันเวลา ไว้แล้ว · แก้รุ่น/ผู้ส่งที่นี่ = ประทับข้อความใหม่ให้
   แท็บ "บัญชี LINE" = ผูก/ปลดผูกบัญชีไลน์กับสมาชิก (สมาชิกผูกเองได้ด้วยการพิมพ์ "ผูก M001" ในกลุ่ม) */

const thDay = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00')
  .toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
const thMonth = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const hhmm = (iso: string) => (iso || '').slice(11, 16);
const SOURCE: Record<string, string> = { text: 'พิมพ์มาเอง', guess: 'เดาจากงานที่เบิก', pick: 'เลือกในไลน์', admin: 'แก้ในเว็บ' };

export default function NgAlbum() {
  const [tab, setTab] = useState<'album' | 'users'>('album');
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Images className="w-5 h-5 text-rose-500" />อัลบั้มงาน NG</h1>
        <div className="ml-auto inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
          {([['album', 'อัลบั้ม'], ['users', 'บัญชี LINE']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md ${tab === k ? 'bg-white shadow text-gray-900 font-semibold' : 'text-gray-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'album' ? <Album /> : <LineUsers />}
    </div>
  );
}

function Album() {
  const [month, setMonth] = useState('');
  const [memberId, setMemberId] = useState<number | ''>('');
  const [productId, setProductId] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const params = { month: month || undefined, member_id: memberId || undefined, product_id: productId || undefined };
  const { data, isLoading } = useQuery({ queryKey: ['ng-photos', params], queryFn: () => ngPhotoApi.list(params) });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const photos: any[] = data?.photos || [];
  const months: any[] = data?.months || [];

  // จัดกลุ่มตามวันที่ส่ง (ใหม่ → เก่า)
  const days = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of photos) { const d = p.sent_at.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d)!.push(p); }
    return [...m.entries()];
  }, [photos]);
  const open = photos.find(p => p.id === openId) || null;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap gap-2 items-center">
        <select value={month} onChange={e => setMonth(e.target.value)} className="border rounded-lg px-2.5 py-2 text-sm">
          <option value="">ทุกเดือน</option>
          {months.map(m => <option key={m.month} value={m.month}>{thMonth(m.month)} ({m.n})</option>)}
        </select>
        <div className="w-64 max-w-full"><MemberSelect members={members} value={memberId} onChange={setMemberId} placeholder="ทุกคน (ค้นหาสมาชิก)" /></div>
        {memberId !== '' && <button onClick={() => setMemberId('')} className="text-xs text-gray-500 underline">ล้างสมาชิก</button>}
        <select value={productId} onChange={e => setProductId(e.target.value)} className="border rounded-lg px-2.5 py-2 text-sm">
          <option value="">ทุกรุ่น</option>
          <option value="none">— ยังไม่ระบุรุ่น —</option>
          {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500">{photos.length} รูป</span>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : photos.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 py-14 text-center text-gray-500 space-y-2">
          <ImageOff className="w-8 h-8 mx-auto text-gray-300" />
          <div>ยังไม่มีรูปงาน NG{month || memberId || productId ? 'ตามตัวกรองนี้' : ''}</div>
          <div className="text-xs text-gray-400">สมาชิกส่งรูปในกลุ่มไลน์ แล้วพิมพ์ "NG" ตามด้วยรุ่น (เช่น NG 676_A) — บอทจะเก็บเข้าอัลบั้มให้เอง</div>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map(([day, list]) => (
            <section key={day}>
              <h2 className="text-sm font-semibold text-gray-600 mb-2">{thDay(day)} <span className="text-gray-400 font-normal">· {list.length} รูป</span></h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {list.map(p => (
                  <button key={p.id} onClick={() => setOpenId(p.id)}
                    className="group text-left bg-white rounded-lg border border-gray-200 overflow-hidden hover:ring-2 hover:ring-rose-300">
                    <div className="aspect-square bg-gray-100 overflow-hidden">
                      <img src={ngPhotoApi.imageUrl(p)} loading="lazy" alt="" className="w-full h-full object-cover group-hover:scale-105 transition" />
                    </div>
                    <div className="px-2 py-1.5 text-xs leading-tight">
                      <div className="font-medium text-gray-800 truncate">{p.member_name || p.sender_name || 'ไม่ทราบชื่อ'}</div>
                      <div className={`truncate ${p.product_name ? 'text-gray-500' : 'text-amber-600'}`}>
                        {p.product_name || 'ยังไม่ระบุรุ่น'} · {hhmm(p.sent_at)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {open && <PhotoModal photo={open} members={members} products={products} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PhotoModal({ photo, members, products, onClose }: { photo: any; members: any[]; products: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [memberId, setMemberId] = useState<number | ''>(photo.member_id || '');
  const [productId, setProductId] = useState<string>(photo.product_id ? String(photo.product_id) : '');
  const [note, setNote] = useState(photo.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = (memberId || null) !== (photo.member_id || null) || (productId || '') !== (photo.product_id ? String(photo.product_id) : '') || note !== (photo.note || '');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await ngPhotoApi.update(photo.id, { member_id: memberId || null, product_id: productId ? Number(productId) : null, note });
      await qc.invalidateQueries({ queryKey: ['ng-photos'] });
    } catch (e: any) { setErr(e?.response?.data?.error || e.message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm('ลบรูปนี้ออกจากอัลบั้ม?')) return;
    await ngPhotoApi.delete(photo.id);
    await qc.invalidateQueries({ queryKey: ['ng-photos'] });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[95vh] overflow-auto flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
        <div className="md:flex-1 bg-gray-900 flex items-center justify-center min-h-[240px]">
          <img src={ngPhotoApi.imageUrl(photo)} alt="" className="max-h-[60vh] md:max-h-[90vh] w-auto object-contain" />
        </div>
        <div className="md:w-80 p-4 space-y-3 text-sm">
          <div className="flex items-start">
            <div>
              <div className="font-semibold text-gray-800">{thDay(photo.sent_at)} {hhmm(photo.sent_at)} น.</div>
              <div className="text-xs text-gray-500">ชื่อในไลน์: {photo.sender_name || '-'}</div>
            </div>
            <button onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">สมาชิก</span>
            <MemberSelect members={members} value={memberId} onChange={setMemberId} placeholder="เลือกสมาชิก" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">รุ่น {photo.product_source && <span className="text-gray-400">({SOURCE[photo.product_source] || photo.product_source})</span>}</span>
            <select value={productId} onChange={e => setProductId(e.target.value)} className="mt-0.5 w-full border rounded-lg px-2.5 py-2">
              <option value="">— ยังไม่ระบุรุ่น —</option>
              {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">หมายเหตุ</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-0.5 w-full border rounded-lg px-2.5 py-2" placeholder="เช่น ตัดโดนสายไฟ" />
          </label>
          {err && <div className="text-rose-600 text-xs">{err}</div>}
          <button disabled={!dirty || busy} onClick={save}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 text-white py-2 font-semibold disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}บันทึก (ประทับข้อความใหม่)
          </button>
          <div className="flex gap-2">
            <a href={ngPhotoApi.imageUrl(photo) + '&download=1'} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border py-1.5 text-gray-700 hover:bg-gray-50">
              <Download className="w-4 h-4" />รูปประทับ
            </a>
            <a href={ngPhotoApi.imageUrl(photo, 'o') + '&download=1'} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border py-1.5 text-gray-700 hover:bg-gray-50">
              <Download className="w-4 h-4" />ต้นฉบับ
            </a>
          </div>
          <button onClick={remove} className="w-full inline-flex items-center justify-center gap-1 rounded-lg text-rose-600 py-1.5 hover:bg-rose-50">
            <Trash2 className="w-4 h-4" />ลบออกจากอัลบั้ม
          </button>
        </div>
      </div>
    </div>
  );
}

function LineUsers() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({ queryKey: ['line-users'], queryFn: ngPhotoApi.lineUsers });
  const { data: members = [] } = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const link = async (userId: string, memberId: number | null) => {
    setErr('');
    try {
      await ngPhotoApi.linkLineUser(userId, memberId);
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['line-users'] });
      await qc.invalidateQueries({ queryKey: ['ng-photos'] });
    } catch (e: any) { setErr(e?.response?.data?.error || e.message); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-900 flex gap-2">
        <MessageCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>สมาชิกผูกบัญชีเองได้ โดยพิมพ์ในกลุ่มไลน์ว่า <b>ผูก M001</b> (รหัสสมาชิกของตัวเอง) · รายชื่อด้านล่างคือทุกคนที่เคยพิมพ์ในกลุ่มหลังเปิดบอท — คนที่ยังไม่ผูกขึ้นก่อน</div>
      </div>
      {err && <div className="text-rose-600 text-sm">{err}</div>}
      <div className="bg-white rounded-xl border border-gray-200 divide-y">
        {isLoading ? <div className="p-6 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          : users.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">ยังไม่มีใครพิมพ์ในกลุ่มหลังเปิดบอท</div>
          : users.map((u: any) => (
            <div key={u.user_id} className="p-3 flex flex-wrap items-center gap-2 text-sm">
              <div className="min-w-[10rem]">
                <div className="font-medium text-gray-800">{u.display_name || '(ไม่ทราบชื่อไลน์)'}</div>
                <div className="text-xs text-gray-400">ล่าสุด {u.last_seen ? new Date(u.last_seen.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'} · รูป NG {u.photo_count}</div>
              </div>
              <div className="flex-1 min-w-[12rem]">
                {editing === u.user_id ? (
                  <div className="flex gap-2 items-center">
                    <div className="flex-1"><MemberSelect members={members} value="" onChange={id => id && link(u.user_id, id)} placeholder="เลือกสมาชิกที่จะผูก" autoOpenKey={1} /></div>
                    <button onClick={() => setEditing(null)} className="text-gray-400"><X className="w-4 h-4" /></button>
                  </div>
                ) : u.member_id ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-0.5">
                    <Link2 className="w-3.5 h-3.5" />{u.member_name} ({u.member_code})
                    <span className="text-emerald-500 text-xs">· {u.linked_by === 'self' ? 'ผูกเอง' : `โดย ${u.linked_by}`}</span>
                  </span>
                ) : <span className="inline-flex rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2.5 py-0.5">ยังไม่ผูก</span>}
              </div>
              {editing !== u.user_id && (
                <div className="flex gap-1">
                  <button onClick={() => setEditing(u.user_id)} className="rounded-lg border px-2.5 py-1 text-gray-700 hover:bg-gray-50">{u.member_id ? 'เปลี่ยน' : 'ผูกสมาชิก'}</button>
                  {u.member_id && (
                    <button onClick={() => confirm(`ปลดผูก ${u.member_name}?`) && link(u.user_id, null)} className="rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50" title="ปลดผูก">
                      <Unlink className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
