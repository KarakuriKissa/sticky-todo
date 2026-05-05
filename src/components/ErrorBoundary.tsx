import React from 'react';

interface State { error: Error | null; info: string | null; }

// Catches uncaught render-time errors so the user sees a recovery screen
// instead of a blank window. Saves a copy of the error to localStorage so
// it survives reloads.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack = info.componentStack ?? '';
    console.error('[ErrorBoundary] caught:', error, stack);
    try {
      localStorage.setItem(
        'sticky-todo:last-crash',
        JSON.stringify({ at: new Date().toISOString(), message: error.message, stack: error.stack, component: stack }),
      );
    } catch {}
    this.setState({ info: stack });
  }

  reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#1f2937', color: 'white',
        padding: 24, overflow: 'auto', fontFamily: 'system-ui',
      }}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>⚠ アプリでエラーが発生しました</h1>
        <p style={{ fontSize: 13, lineHeight: 1.7 }}>
          ご不便をおかけして申し訳ありません。データはローカルに保存されているので失われません。<br />
          下のボタンで再読み込みするか、それでも直らない場合は「データベースをエクスポート」してから再起動してください。
        </p>
        <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
          <button onClick={this.reload} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            🔄 再読み込み
          </button>
          <button onClick={() => { localStorage.removeItem('sticky-todo:last-crash'); this.setState({ error: null, info: null }); }} style={{ padding: '8px 16px', background: 'rgba(255,255,255,.1)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            ⏭ 無視して続行
          </button>
        </div>
        <details style={{ fontSize: 11, opacity: 0.7 }}>
          <summary style={{ cursor: 'pointer' }}>エラー詳細（開発者向け）</summary>
          <pre style={{ background: 'rgba(0,0,0,.3)', padding: 10, borderRadius: 4, marginTop: 8, whiteSpace: 'pre-wrap' }}>
{this.state.error.message}
{'\n'}
{this.state.error.stack}
{this.state.info && '\n'}{this.state.info}
          </pre>
        </details>
      </div>
    );
  }
}
