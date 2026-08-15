import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render/lifecycle errors anywhere below it in the tree (hooks
// alone can't — React only supports this via a class component) and shows
// a recoverable message instead of leaving the page blank. Without this,
// any uncaught error while rendering a page (bad data shape, a null
// dereference, ...) unmounts the entire app with nothing on screen — which
// reads as "the page crashed" even though it's really just an unhandled
// JS exception.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <p className="text-gray-100 font-semibold mb-1">Something went wrong on this page</p>
            <p className="text-gray-500 text-sm mb-4">{this.state.error.message}</p>
            <button className="btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
