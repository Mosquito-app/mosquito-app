import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { getGetCurrentUserQueryKey, useLogin, useRegister } from '@workspace/api-client-react';
import type { AuthResponse } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, InlineError } from '@/components/common';

const signedIn = (result: AuthResponse) => { queryClient.clear(); queryClient.setQueryData(getGetCurrentUserQueryKey(), result); };

function registrationErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      switch (data.error) {
        case 'Email already registered':
          return 'This email is already registered. Please click Sign In instead.';
        case 'Username already registered':
          return 'That player name is already taken. Choose another.';
        case 'Password must be at least 4 characters long.':
          return 'Password must be at least 4 characters long.';
        case 'Enter a valid email address.':
          return 'Enter a valid email address.';
        case 'Enter a valid username.':
          return 'Enter a valid player name.';
        default:
          return data.error;
      }
    }
  }
  return 'Could not create that account. Please try again.';
}

export function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    login.mutate({ data: { email: email.trim(), password } }, {
      onSuccess: result => { signedIn(result); setLocation('/'); },
      onError: () => setError('That sign-in did not work. Check your details and try again.'),
    });
  };
  return <AuthFrame mode="login" heading="Welcome back." copy="Take your seat. Your next match is waiting.">
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-email" /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" data-testid="input-password" /></label>
      {error && <InlineError>{error}</InlineError>}
      <button className="primary-btn full" type="submit" disabled={login.isPending} data-testid="button-login">{login.isPending ? 'Finding your seat…' : 'Sign in'} <ArrowRight size={17} /></button>
    </form>
  </AuthFrame>;
}

export function RegisterPage() {
  const [, setLocation] = useLocation();
  const register = useRegister();
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    register.mutate({ data: { username: username.trim(), email: email.trim().toLowerCase(), password } }, {
      onSuccess: result => { signedIn(result); setLocation('/'); },
      onError: error => setError(registrationErrorMessage(error)),
    });
  };
  return <AuthFrame mode="register" heading="Pull up a chair." copy="Create a local account and get straight to the board.">
    <form className="auth-form" onSubmit={submit}>
      <label>Player name<input autoComplete="nickname" required minLength={3} maxLength={24} value={username} onChange={e => setUsername(e.target.value)} placeholder="How players will know you" data-testid="input-username" /></label>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} onBlur={e => setEmail(e.target.value.trim().toLowerCase())} placeholder="you@example.com" data-testid="input-email" /></label>
      <label>Password<input type="password" autoComplete="new-password" required minLength={4} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 4 characters" data-testid="input-password" /></label>
      {error && <InlineError>{error}</InlineError>}
      <button className="primary-btn full" type="submit" disabled={register.isPending} data-testid="button-register">{register.isPending ? 'Setting up your seat…' : 'Create account'} <ArrowRight size={17} /></button>
    </form>
  </AuthFrame>;
}
