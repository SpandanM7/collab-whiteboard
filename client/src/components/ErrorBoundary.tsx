import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type State = { failed: boolean };

/** Last line of defence: an unexpected render error shows a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="landing">
        <h1>Something went wrong</h1>
        <p>The whiteboard hit an unexpected error. Your board is safe on the server.</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
