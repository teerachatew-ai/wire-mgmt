import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Check, ChevronDown } from 'lucide-react';

interface Member {
  id: number;
  code: string;
  name: string;
  nickname?: string | null;
  status?: string;
  grade?: string;
  batch_count?: number;
}

const gradeStyle: Record<string, string> = {
  A: 'bg-amber-100 text-amber-700',
  B: 'bg-slate-100 text-slate-500',
  C: 'bg-rose-100 text-rose-600',
};
const gradeRank: Record<string, number> = { A: 0, B: 1, C: 2 };

interface Props {
  members: Member[];
  value: number | string | '';
  onChange: (id: number | '') => void;
  placeholder?: string;
  activeOnly?: boolean;
}

/* Searchable member picker — filter by name / nickname / code */
export default function MemberSelect({ members, value, onChange, placeholder = 'ค้นหาชื่อ-สกุล หรือชื่อเล่น...', activeOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const pool = useMemo(
    () => activeOnly ? members.filter(m => m.status === 'active') : members,
    [members, activeOnly]
  );

  const selected = useMemo(
    () => pool.find(m => String(m.id) === String(value)),
    [pool, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q ? pool : pool.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.nickname ?? '').toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q)
    );
    // เรียงตามเกรด (A ก่อน) เพื่อให้แจกงานคนเกรดดีก่อน
    return [...list].sort((a, b) =>
      (gradeRank[a.grade ?? 'A'] ?? 0) - (gradeRank[b.grade ?? 'A'] ?? 0)
      || a.code.localeCompare(b.code)
    );
  }, [pool, query]);

  // close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (m: Member) => {
    onChange(m.id);
    setOpen(false);
    setQuery('');
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input flex items-center justify-between text-left w-full"
      >
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-xs text-blue-600 mr-1.5">{selected.code}</span>
            {selected.name}
            {selected.nickname && <span className="text-gray-400 ml-1">({selected.nickname})</span>}
          </span>
        ) : (
          <span className="text-gray-400">-- เลือกสมาชิก --</span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <X size={16} className="text-gray-400 hover:text-red-500" onClick={clear} />
          )}
          <ChevronDown size={16} className="text-gray-400" />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 flex flex-col">
          <div className="p-2 border-b sticky top-0 bg-white">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={placeholder}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">ไม่พบสมาชิก</div>
            )}
            {filtered.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => pick(m)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-blue-50 transition-colors ${String(m.id) === String(value) ? 'bg-blue-50' : ''}`}
              >
                <span className="font-mono text-xs text-blue-600 w-12 shrink-0">{m.code}</span>
                <span className="flex-1 truncate">
                  {m.name}
                  {m.nickname && <span className="text-gray-400 ml-1">({m.nickname})</span>}
                </span>
                {m.grade && (m.batch_count ?? 0) > 0 && (
                  <span className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded ${gradeStyle[m.grade] || gradeStyle.B}`}>
                    {m.grade === 'A' ? '★A' : m.grade}
                  </span>
                )}
                {String(m.id) === String(value) && <Check size={16} className="text-blue-600 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
