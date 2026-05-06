// ErrorBoundary smoke tests — verifies the recovery screen kicks in when a
// child throws, and that the crash is captured to localStorage for diagnosis.
import { describe, it, expect, beforeEach, mock } from 'bun:test';

if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => _store.get(k) ?? null,
    setItem: (k: string, v: string) => { _store.set(k, v); },
    removeItem: (k: string) => { _store.delete(k); },
    clear: () => { _store.clear(); },
    key: (i: number) => Array.from(_store.keys())[i] ?? null,
    get length() { return _store.size; },
  };
}

// Suppress React's noisy "uncaught error" log during the boundary test.
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const first = String(args[0] ?? '');
  if (first.includes('ErrorBoundary') || first.includes('intentional crash')) return;
  if (first.includes('The above error') || first.includes('Consider adding')) return;
  originalConsoleError(...args);
};

const { ErrorBoundary } = await import('../src/components/ErrorBoundary');

// Bare-minimum React renderer: we don't pull in jsdom; we just instantiate the
// class and exercise its lifecycle methods directly. That's enough to lock in
// the contract.
describe('ErrorBoundary', () => {
  beforeEach(() => { localStorage.clear(); });

  it('starts with no error state', () => {
    const inst = new (ErrorBoundary as any)({ children: null });
    expect(inst.state.error).toBeNull();
  });

  it('getDerivedStateFromError captures the error', () => {
    const err = new Error('intentional crash for test');
    const next = (ErrorBoundary as any).getDerivedStateFromError(err);
    expect(next.error).toBe(err);
  });

  it('componentDidCatch persists the crash to localStorage', () => {
    const inst = new (ErrorBoundary as any)({ children: null });
    inst.setState = (patch: any) => { Object.assign(inst.state, patch); };
    inst.componentDidCatch(new Error('intentional crash for test'), {
      componentStack: '\n    at Foo\n    at Bar',
    });
    const dump = localStorage.getItem('sticky-todo:last-crash');
    expect(dump).not.toBeNull();
    const parsed = JSON.parse(dump!);
    expect(parsed.message).toBe('intentional crash for test');
    expect(parsed.component).toContain('Foo');
  });
});
