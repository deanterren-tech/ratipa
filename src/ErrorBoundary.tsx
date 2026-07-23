import  { Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ errorInfo });
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if ((this.state as any).hasError) {
      return (
        <div style={{ padding: 20, background: 'white', color: 'red' }}>
          <h2>Something went wrong.</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {(this.state as any).error && (this.state as any).error.toString()}
            <br />
            {(this.state as any).errorInfo && (this.state as any).errorInfo.componentStack}
          </details>
        </div>
      );
    }

    return (this.props as any).children;
  }
}