import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Gamepad2, LogOut, ShieldCheck } from 'lucide-react';

export const money = (value: number) => `₦${value.toLocaleString('en-NG')}`;
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand-lockup" aria-label="Mosquito App home" data-testid="link-home">
    <span className="brand-mark"><img src={`${import.meta.env.BASE_URL}mosquito-mark.svg`} width="25" height="25" alt="" /></span>
    {!compact && <span className="brand-word">Mosquito<span> App</span></span>}
  </Link>;
}

export function Shell({ children, user, onLogout, roomPicker = false }: { children: ReactNode; user?: { username: string }; onLogout?: () => void; roomPicker?: boolean }) {
  return <div className={`app-shell noise ${roomPicker ? 'room-picker-shell' : ''}`}>
    <aside className="side-rail">
      <Brand />
      <div className="rail-label">THE TABLE</div>
      <Link href="/" className="rail-link active" data-testid="link-lobby"><Gamepad2 size={18} /> <span>Lobby</span><i /></Link>
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="sandbox-mini"><span className="pulse-dot" /> MOSQUITO WALLET</div>
        <div className="rail-user">
          <div className="avatar">{user?.username?.slice(0, 1).toUpperCase() || 'M'}</div>
          <div className="rail-user-meta"><strong>{user?.username || 'Guest player'}</strong><small>Local account</small></div>
          {onLogout && <button className="icon-btn rail-logout" onClick={onLogout} aria-label="Sign out" data-testid="button-logout"><LogOut size={16} /></button>}
        </div>
        <p>Built for the next move.</p>
      </div>
    </aside>
    <main className="main-stage">
      <header className="topbar">
        <div className="mobile-brand"><Brand /></div>
        <div className="crumb"><span>Mosquito App</span><span className="crumb-slash">/</span><b>LOBBY</b></div>
        <div className="topbar-right"><span className="topbar-time">LAGOS · WAT</span></div>
      </header>
      {children}
    </main>
  </div>;
}

export function InlineError({ children }: { children: ReactNode }) {
  return <div className="inline-error" role="alert" data-testid="status-error">{children}</div>;
}
export function LoadingBlock({ label = 'Loading your table' }: { label?: string }) {
  return <div className="loading-block" data-testid="status-loading"><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="loading-label">{label}…</span></div>;
}

export function AuthFrame({ children, heading, copy, mode }: { children: ReactNode; heading: string; copy: string; mode: 'login' | 'register' }) {
  return <div className="auth-page noise">
    <header className="auth-head"><Brand /></header>
    <div className="auth-layout">
      <section className="auth-aside">
        <div className="auth-eyebrow"><span className="eyebrow-dash" /> THE GAME IS ON</div>
        <h1>Welcome to<br /><em>Mosquito App.</em></h1>
        <p>Two players. One board. Just you, your tactics, and a little luck.</p>
        <div className="auth-board">
          <div className="auth-board-center"><span>M</span></div>
          <i className="auth-token token-coral" /><i className="auth-token token-green" /><i className="auth-token token-yellow" />
          <div className="auth-board-caption">A GOOD GAME STARTS HERE</div>
        </div>
      </section>
      <section className="auth-card page-in">
        <div className="auth-card-kicker">LOCAL PLAYER ACCOUNT</div>
        <h2>{heading}</h2><p className="auth-card-copy">{copy}</p>
        {children}
        <div className="auth-switch">{mode === 'login' ? <>New to the table? <Link href="/register" data-testid="link-register">Create an account <ArrowRight size={14} /></Link></> : <>Already have a seat? <Link href="/login" data-testid="link-login">Sign in <ArrowRight size={14} /></Link></>}</div>
        <div className="auth-note"><ShieldCheck size={15} /> Local player account.</div>
      </section>
    </div>
    <footer className="auth-footer"><span>MOSQUITO APP · A GAME OF GOOD JUDGMENT</span></footer>
  </div>;
}
