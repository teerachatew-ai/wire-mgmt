import { useState } from 'react';
import { useAuth } from '../auth';
import { LogIn, Lock, User } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!login(username, password)) {
      setErr('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto mb-3">
            <LogIn size={26} />
          </div>
          <h1 className="text-lg font-bold text-gray-800">ระบบบริหารงานจ้างเหมาตัดสายไฟ</h1>
          <p className="text-sm text-gray-500">วิสาหกิจชุมชน — เข้าสู่ระบบ</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
          <div>
            <label className="label">ชื่อผู้ใช้</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="เช่น ดาว หรือ หนูนา" value={username}
                onChange={e => { setUsername(e.target.value); setErr(''); }} autoFocus />
            </div>
          </div>
          <div>
            <label className="label">รหัสผ่าน</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="password" className="input pl-9" placeholder="รหัสผ่าน" value={password}
                onChange={e => { setPassword(e.target.value); setErr(''); }} />
            </div>
          </div>
          {err && <p className="text-red-500 text-sm">{err}</p>}
          <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2">
            <LogIn size={16} /> เข้าสู่ระบบ
          </button>
        </form>
      </div>
    </div>
  );
}
