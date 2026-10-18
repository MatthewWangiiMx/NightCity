import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * TEMPORARY diagnostic — delete once the blank-page crash is fixed.
 *
 * Without a boundary, an uncaught error unmounts the whole React root and
 * leaves the bare body colour, which tells you nothing. This catches the
 * error and prints it on the page instead.
 *
 * It also listens for window errors and unhandled promise rejections, because
 * an error thrown inside a `.then()` never reaches a boundary at all — and the
 * city massing is fetched asynchronously, so that is a live possibility here.
 *
 * Styling is inline on purpose: it has to render even if the stylesheet is
 * part of what is broken.
 */

type Captured = { kind: string; message: string; stack: string };

const shell: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483647,
  overflow: 'auto',
  padding: '24px',
  background: '#0b0406',
  color: '#ffd9d9',
  font: '13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
};

const card: React.CSSProperties = {
  maxWidth: '1000px',
  margin: '0 auto',
  border: '1px solid #7f1d1d',
  borderRadius: '12px',
  background: '#160709',
  padding: '20px',
};

const pre: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '8px 0 0',
  padding: '12px',
  borderRadius: '8px',
  background: '#000',
  color: '#ffb4b4',
  maxHeight: '340px',
  overflow: 'auto',
};

export default class DebugErrorBoundary extends Component<
  { children: ReactNode },
  { caught: Captured[]; hasError: boolean }
> {
  state = { caught: [] as Captured[], hasError: false };

  private add(next: Captured) {
    // Never let the reporter itself loop: cap what we keep.
    this.setState((prev) =>
      prev.caught.length >= 5 ? null : { caught: [...prev.caught, next] },
    );
  }

  componentDidMount() {
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  onWindowError = (e: ErrorEvent) => {
    this.add({
      kind: 'window error',
      message: e.message || String(e.error),
      stack: (e.error?.stack as string) ?? e.filename + ':' + e.lineno + ':' + e.colno,
    });
  };

  onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    this.add({
      kind: 'unhandled promise rejection',
      message: r instanceof Error ? r.message : String(r),
      stack: r instanceof Error ? (r.stack ?? '') : '',
    });
  };

  // Stops children re-rendering: without this React retries them, throws
  // again and unmounts the root, which is the behaviour we are replacing.
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.add({
      kind: 'react render/effect error',
      message: error.message,
      stack: (error.stack ?? '') + '\n\n--- component stack ---' + info.componentStack,
    });
  }

  render() {
    const { caught, hasError } = this.state;

    return (
      <>
        {/* A non-fatal error leaves the app mounted and shows the report over it. */}
        {!hasError && this.props.children}

        {(hasError || caught.length > 0) && (
          <div style={shell}>
            <div style={card}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#ff8585' }}>
                {caught.length || 1} error{caught.length > 1 ? 's' : ''} captured
              </div>
              <div style={{ marginTop: '4px', color: '#c49b9b' }}>
                Temporary diagnostic boundary. Copy this and hand it over.
              </div>

              <button
                type="button"
                onClick={() => {
                  const text = caught
                    .map((c) => '[' + c.kind + '] ' + c.message + '\n' + c.stack)
                    .join('\n\n========\n\n');
                  void navigator.clipboard?.writeText(text);
                }}
                style={{
                  marginTop: '12px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #7f1d1d',
                  background: '#2a0d10',
                  color: '#ffd9d9',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                Copy all
              </button>

              {caught.map((c, i) => (
                <div key={i} style={{ marginTop: '18px' }}>
                  <div style={{ color: '#ff8585', fontWeight: 700 }}>
                    {i + 1}. {c.kind}
                  </div>
                  <div style={{ marginTop: '2px', color: '#ffecec' }}>{c.message}</div>
                  <pre style={pre}>{c.stack || '(no stack)'}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
}
