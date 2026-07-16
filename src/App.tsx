import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, LoaderCircle, LogOut, WifiOff } from 'lucide-react'
import logo from '../Logo.jpeg'
import { repository } from './data'
import type { Role } from './types'
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const ScorerPage = lazy(() => import('./pages/ScorerPage').then((module) => ({ default: module.ScorerPage })))
const NfcPage = lazy(() => import('./pages/NfcPage').then((module) => ({ default: module.NfcPage })))

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand--compact' : ''}`}><img src={logo} alt="Saint Paul Sports Team" /></div>
}

function StatusScreen({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return <main className="center-screen"><Brand /><section className="status-block">{icon}<h1>{title}</h1>{body && <p>{body}</p>}{action}</section></main>
}

function Login({ role }: { role: Role }) {
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const queryClient = useQueryClient()
  const scorerOptions = useQuery({
    queryKey: ['scorer-login-options'],
    queryFn: () => repository.getScorerLoginOptions(),
    enabled: role === 'scorer',
    staleTime: 5 * 60 * 1000,
  })
  const mutation = useMutation({ mutationFn: () => repository.signIn(identity, password), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }) })
  const submit = (event: FormEvent) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate() }
  const scorerUnavailable = role === 'scorer' && (scorerOptions.isLoading || scorerOptions.isError)
  return <main className="center-screen login"><Brand /><section><p className="eyebrow">ليلة الكامب</p><h1>ادخل على مهمتك</h1><p className="muted">الحساب بيحدد صلاحياتك تلقائيًا.</p><form onSubmit={submit} className="stack-form">
    {role === 'scorer' ? <label>اسم المستخدم<select dir="ltr" required value={identity} disabled={scorerUnavailable} onChange={(e) => setIdentity(e.target.value)}><option value="">{scorerOptions.isLoading ? 'بنحمّل الحسابات...' : 'اختار الـUsername'}</option>{scorerOptions.data?.map((username) => <option key={username} value={username}>{username}</option>)}</select></label> : <label>اسم المستخدم<input dir="ltr" type="text" autoCapitalize="none" autoComplete="username" spellCheck={false} required value={identity} onChange={(e) => setIdentity(e.target.value)} /></label>}
    {scorerOptions.isError && <div className="inline-alert error" role="alert"><AlertTriangle size={19} /><span>معرفناش نحمّل الحسابات.</span><button type="button" className="text-button" onClick={() => scorerOptions.refetch()}>حاول تاني</button></div>}
    <label>كلمة السر<input dir="ltr" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {mutation.error && <div className="inline-alert error" role="alert"><AlertTriangle size={19} />تعذر تسجيل الدخول. راجع البيانات وحاول تاني.</div>}
    <button className="primary-button" disabled={mutation.isPending || scorerUnavailable || !identity}>{mutation.isPending ? <><LoaderCircle className="spin" />جاري الدخول</> : 'دخول'}</button>
  </form></section></main>
}

function Protected({ role, children }: { role: Role; children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => repository.getAuth() })
  const logout = useMutation({ mutationFn: () => repository.signOut(), onSuccess: () => { queryClient.clear(); navigate('/') } })
  if (auth.isLoading) return <StatusScreen title="بنجهز الملعب" body="ثواني ونجيب مهمتك." icon={<LoaderCircle className="spin status-icon" />} />
  if (auth.isError) return <StatusScreen title="الاتصال وقف" body="اتأكد من الشبكة وحاول تاني." icon={<WifiOff className="status-icon" />} action={<button className="secondary-button" onClick={() => auth.refetch()}>إعادة المحاولة</button>} />
  if (!auth.data) return <Login role={role} />
  if (auth.data.profile.role !== role) return <StatusScreen title="المسار مش متاح لحسابك" body={`أنت داخل بصلاحية ${auth.data.profile.role === 'admin' ? 'مسؤول' : 'مسجّل نتائج'}.`} icon={<AlertTriangle className="status-icon" />} action={<button className="secondary-button" onClick={() => navigate(auth.data!.profile.role === 'admin' ? '/admin' : '/scorer')}>روح لمساحتك</button>} />
  return <div className="app-frame"><header className="topbar"><Brand compact /><div><strong>{auth.data.profile.displayName}</strong><span>{role === 'admin' ? 'مسؤول الكامب' : 'مسجّل نتائج'}</span></div><button className="icon-button" aria-label="تسجيل الخروج" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut /></button></header><div key={location.pathname}>{children}</div></div>
}

export function App() {
  return <Suspense fallback={<StatusScreen title="بنجهز الصفحة" icon={<LoaderCircle className="spin status-icon" />} />}><Routes>
    <Route path="/admin/*" element={<Protected role="admin"><AdminPage /></Protected>} />
    <Route path="/scorer" element={<Protected role="scorer"><ScorerPage /></Protected>} />
    <Route path="/nfc" element={<NfcPage />} />
    <Route path="/nfc/:token" element={<NfcPage />} />
    <Route path="*" element={<Navigate to="/scorer" replace />} />
  </Routes></Suspense>
}
