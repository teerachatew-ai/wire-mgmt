import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crown, Dumbbell, ShieldCheck, Check, Loader2, ChevronDown, Users } from 'lucide-react';
import { memberApi } from '../api';

/* ── ตำแหน่งแอดมินของสมาชิก (ใช้กำหนดปริมาณงานในหน้า "วางแผนแจกงาน") ──
   lifter = ช่วยยกงาน (ได้งานมากสุด 750–1,000 ชุด/วัน) · admin = แอดมินทั่วไป (มากกว่าคนทั่วไป น้อยกว่าคนยกงาน) */
export type AdminRole = 'lifter' | 'admin' | null;

export const ROLE_META: Record<'lifter' | 'admin', { label: string; short: string; cls: string; Icon: any }> = {
  lifter: { label: 'ช่วยยกงาน', short: 'ยกงาน', cls: 'bg-orange-100 text-orange-800 ring-orange-200', Icon: Dumbbell },
  admin: { label: 'แอดมินทั่วไป', short: 'แอดมิน', cls: 'bg-violet-100 text-violet-800 ring-violet-200', Icon: ShieldCheck },
};

export function AdminRoleBadge({ role, compact }: { role: AdminRole; compact?: boolean }) {
  if (!role) return null;
  const m = ROLE_META[role];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap ${m.cls}`} title={m.label}>
      <m.Icon size={11} /> {compact ? m.short : m.label}
    </span>
  );
}

// ปุ่มแต่งตั้ง: ยังไม่มีตำแหน่ง = ปุ่มเส้นประ "แต่งตั้ง" · มีแล้ว = badge สี + ลูกศร กดเปลี่ยนได้
// เมนูวาดลง document.body (portal) — ไม่โดนตารางที่เลื่อนแนวนอน/แถวที่มี filter ตอน hover ตัดหรือดันตำแหน่ง
export function AdminRolePicker({ member, compact }: { member: { id: number; admin_role?: AdminRole }; compact?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const role = (member.admin_role || null) as AdminRole;
  const mut = useMutation({
    mutationFn: (r: AdminRole) => memberApi.setRole(member.id, r),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); qc.invalidateQueries({ queryKey: ['distribution-context'] }); setOpen(false); },
    onError: (e: any) => alert(e?.response?.data?.error || 'บันทึกไม่สำเร็จ'),
  });
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(), 0);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current!.getBoundingClientRect();
    const h = 236, w = 248;
    const below = r.bottom + 6 + h <= window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h), left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    setOpen(o => !o);
  };

  const opts: { v: AdminRole; label: string; desc: string; Icon: any; cls: string }[] = [
    { v: 'lifter', label: 'ช่วยยกงาน', desc: 'ได้งาน 750–1,000 ชุด/วัน', Icon: Dumbbell, cls: 'bg-orange-100 text-orange-700' },
    { v: 'admin', label: 'แอดมินทั่วไป', desc: 'ได้งานมากกว่าคนทั่วไป', Icon: ShieldCheck, cls: 'bg-violet-100 text-violet-700' },
    { v: null, label: 'สมาชิกทั่วไป', desc: 'ไม่มีตำแหน่ง', Icon: Users, cls: 'bg-gray-100 text-gray-500' },
  ];
  const meta = role ? ROLE_META[role] : null;
  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open}
        title={role ? `ตำแหน่ง: ${meta!.label} — กดเพื่อเปลี่ยน` : 'แต่งตั้งเป็นแอดมิน'}
        className={`inline-flex items-center gap-1 rounded-full whitespace-nowrap font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400
          ${compact ? 'min-h-[26px] px-2 text-[11px]' : 'min-h-[32px] px-3 text-xs'}
          ${meta ? `ring-1 ${meta.cls} hover:brightness-95` : 'border border-dashed border-amber-400 text-amber-700 bg-amber-50/60 hover:bg-amber-100'}`}>
        {mut.isPending ? <Loader2 size={13} className="animate-spin" /> : meta ? <meta.Icon size={13} /> : <Crown size={13} />}
        {meta ? (compact ? meta.short : meta.label) : 'แต่งตั้ง'}
        <ChevronDown size={12} className="opacity-60" />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" aria-label="แต่งตั้งตำแหน่ง" style={{ top: pos.top, left: pos.left }}
          className="fixed z-[200] w-[248px] rounded-2xl border bg-white shadow-2xl p-1.5 text-left">
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-gray-400">แต่งตั้งตำแหน่ง</p>
          {opts.map(o => (
            <button key={String(o.v)} type="button" role="menuitem" disabled={mut.isPending}
              onClick={e => { e.stopPropagation(); if (o.v === role) setOpen(false); else mut.mutate(o.v); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left min-h-[48px] focus:outline-none focus-visible:bg-sky-50 hover:bg-gray-50 ${role === o.v ? 'bg-sky-50' : ''}`}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${o.cls}`}><o.Icon size={15} /></span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-gray-800">{o.label}</span>
                <span className="block text-[11px] text-gray-500">{o.desc}</span>
              </span>
              {role === o.v && <Check size={16} className="text-sky-600 shrink-0" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
