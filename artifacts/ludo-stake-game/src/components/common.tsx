import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Gamepad2, LogOut, ShieldCheck } from 'lucide-react';

export const money = (value: number) => `₦${value.toLocaleString('en-NG')}`;
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand-lockup" data-testid="link-home">
    <span className="brand-mark"><Gamepad2 size={19} strokeWidth={2.5} /></span>
    {!compact && <span className="brand-word">LUDO<span>ROOM</span></span>}
  </Link>;
}

export function Shell({ children, user, onLogout }: { children: ReactNode; user?: { username: string }; onLogout?: () => void }) {
  return <div className="app-shell noise">
    <aside className="side-rail">
      <Brand />
      <div className="rail-label">THE TABLE</div>
      <Link href="/" className="rail-link active" data-testid="link-lobby"><Gamepad2 size={18} /> <span>Lobby</span><i /></Link>
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="sandbox-mini"><span className="pulse-dot" /> SANDBOX MODE</div>
        <div className="rail-user">
          <div className="avatar">{user?.username?.slice(0, 1).toUpperCase() || 'L'}</div>
          <div className="rail-user-meta"><strong>{user?.username || 'Guest player'}</strong><small>Local account</small></div>
          {onLogout && <button className="icon-btn rail-logout" onClick={onLogout} aria-label="Sign out" data-testid="button-logout"><LogOut size={16} /></button>}
        </div>
        <p>Built for the next move.</p>
      </div>
    </aside>
    <main className="main-stage">
      <header className="topbar">
        <div className="mobile-brand"><Brand /></div>
        <div className="crumb"><span>PLAY</span><span className="crumb-slash">/</span><b>LOBBY</b></div>
        <div className="topbar-right"><span className="sandbox-pill"><ShieldCheck size={14} /> TEST PLAY ONLY</span><span className="topbar-time">LAGOS · WAT</span></div>
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
    <header className="auth-head"><Brand /><span className="sandbox-pill"><ShieldCheck size={14} /> SANDBOX ONLY</span></header>
    <div className="auth-layout">
      <section className="auth-aside">
        <div className="auth-eyebrow"><span className="eyebrow-dash" /> THE GAME IS ON</div>
        <h1>Every move<br />has a <em>moment.</em></h1>
        <p>Two players. One board. Just you, your tactics, and a little luck.</p>
        <div className="auth-board">
          <div className="auth-board-center"><span>LR</span></div>
          <i className="auth-token token-coral" /><i className="auth-token token-green" /><i className="auth-token token-yellow" />
          <div className="auth-board-caption">A GOOD GAME STARTS HERE</div>
        </div>
      </section>
      <section className="auth-card page-in">
        <div className="auth-card-kicker">LOCAL PLAYER ACCOUNT</div>
        <h2>{heading}</h2><p className="auth-card-copy">{copy}</p>
        {children}
        <div className="auth-switch">{mode === 'login' ? <>New to the table? <Link href="/register" data-testid="link-register">Create an account <ArrowRight size={14} /></Link></> : <>Already have a seat? <Link href="/login" data-testid="link-login">Sign in <ArrowRight size={14} /></Link></>}</div>
        <div className="auth-note"><ShieldCheck size={15} /> Local account. Sandbox balance. No live money.</div>
      </section>
    </div>
    <footer className="auth-footer"><span>LUDOROOM · A GAME OF GOOD JUDGMENT</span><span>PAYSTACK TEST MODE ONLY</span></footer>
  </div>;
}
