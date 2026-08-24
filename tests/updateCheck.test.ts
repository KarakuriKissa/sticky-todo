// Update-check failure classification: verifies that offline / rate-limit /
// not-found / signature / other failures are actually distinguished (not all
// collapsed into a generic "offline" message like the old fetch-based check).
import { describe, it, expect } from 'bun:test';
import {
  DEV_APP_VERSION,
  classifyPreflight,
  classifyCheckError,
  messageForUpdateFailure,
  type UpdatePreflight,
} from '../src/utils/updateCheck';

describe('classifyPreflight', () => {
  it('Ok means no failure', () => {
    expect(classifyPreflight({ kind: 'Ok' })).toBeNull();
  });

  it('Offline maps to offline failure', () => {
    const f = classifyPreflight({ kind: 'Offline' });
    expect(f?.kind).toBe('offline');
    expect(messageForUpdateFailure(f!)).toContain('ネットに接続');
  });

  it('RateLimited with retry_after_secs computes wait minutes', () => {
    const f = classifyPreflight({ kind: 'RateLimited', retry_after_secs: 125 });
    expect(f).toEqual({ kind: 'rate-limited', waitMinutes: 3 }); // ceil(125/60) = 3
    expect(messageForUpdateFailure(f!)).toContain('3分後');
  });

  it('RateLimited without retry_after_secs still produces a message (no fake number)', () => {
    const f = classifyPreflight({ kind: 'RateLimited', retry_after_secs: null });
    expect(f).toEqual({ kind: 'rate-limited', waitMinutes: null });
    const msg = messageForUpdateFailure(f!);
    expect(msg).toContain('制限');
    expect(msg).not.toMatch(/\d+分後/);
  });

  it('NotFound maps to not-found failure', () => {
    const f = classifyPreflight({ kind: 'NotFound' });
    expect(f?.kind).toBe('not-found');
    expect(messageForUpdateFailure(f!)).toContain('見つかりません');
  });

  it('HttpError carries the status code through to the message', () => {
    const f = classifyPreflight({ kind: 'HttpError', status: 500 });
    expect(f).toEqual({ kind: 'http', status: 500 });
    expect(messageForUpdateFailure(f!)).toContain('500');
  });

  it('every non-Ok UpdatePreflight kind produces a distinct failure kind', () => {
    const kinds: UpdatePreflight[] = [
      { kind: 'Offline' },
      { kind: 'RateLimited', retry_after_secs: 60 },
      { kind: 'NotFound' },
      { kind: 'HttpError', status: 500 },
    ];
    const failureKinds = kinds.map((k) => classifyPreflight(k)?.kind);
    expect(new Set(failureKinds).size).toBe(kinds.length);
  });
});

describe('classifyCheckError', () => {
  it('network/DNS errors from reqwest are classified as offline', () => {
    const raw = 'error sending request for url (https://github.com/...): error trying to connect: dns error: failed to lookup address information';
    expect(classifyCheckError(raw).kind).toBe('offline');
  });

  it('signature verification failures are classified as signature', () => {
    expect(classifyCheckError('Signature verification failed').kind).toBe('signature');
  });

  it('ReleaseNotFound message is classified as not-found', () => {
    expect(classifyCheckError('Could not fetch a valid release JSON from the remote').kind).toBe('not-found');
  });

  it('unrecognized errors fall back to unknown, keeping the raw detail (not swallowed)', () => {
    const f = classifyCheckError('some unexpected internal error');
    expect(f).toEqual({ kind: 'unknown', detail: 'some unexpected internal error' });
    expect(messageForUpdateFailure(f)).toContain('some unexpected internal error');
  });

  it('accepts Error instances, not just strings', () => {
    expect(classifyCheckError(new Error('timed out')).kind).toBe('offline');
  });
});

describe('DEV_APP_VERSION', () => {
  it('matches the version committed in tauri.conf.json / package.json (dev placeholder)', () => {
    expect(DEV_APP_VERSION).toBe('0.1.0');
  });
});
