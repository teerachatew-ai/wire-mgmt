import { createContext, useContext, useState, ReactNode } from 'react';

export type Role = 'admin' | 'dao';
export interface AppUser { key: string; name: string; role: Role; }

// ── ผู้ใช้ระบบ (แก้ชื่อ/รหัสผ่านได้ที่นี่) ─────────────────────────
const USERS: { key: string; name: string; password: string; role: Role }[] = [
  { key: 'noona',     name: 'หนูนา',   password: 'noona3425',   role: 'admin' }, // เห็นทุกเมนู
  { key: 'soonthree', name: 'สุนทรี',  password: 'Pla23261222', role: 'admin' }, // เห็นทุกเมนู
  { key: 'dao',       name: 'ดาว',     password: 'dao123',       role: 'dao' },   // เห็นทุกเมนู ยกเว้นที่ซ่อน
];

// เมนูที่ "ดาว" มองไม่เห็น/เข้าไม่ได้
export const DAO_HIDDEN = ['/', '/products', '/billing', '/ocr', '/settings'];

export function canAccess(role: Role, path: string): boolean {
  if (role === 'admin') return true;
  return !DAO_HIDDEN.includes(path);
}

// หน้าแรกหลัง login ของแต่ละ role
export function homePath(role: Role): string {
  return role === 'admin' ? '/' : '/stock';
}

const STORAGE_KEY = 'wire_user';

function loadUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

interface AuthCtx {
  user: AppUser | null;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}
const Ctx = createContext<AuthCtx>({ user: null, login: () => false, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(loadUser);

  const login = (username: string, password: string) => {
    const u = USERS.find(
      x => (x.key.toLowerCase() === username.trim().toLowerCase() || x.name === username.trim()) && x.password === password
    );
    if (!u) return false;
    const appUser: AppUser = { key: u.key, name: u.name, role: u.role };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appUser));
    setUser(appUser);
    return true;
  };
  const logout = () => { localStorage.removeItem(STORAGE_KEY); setUser(null); };

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
