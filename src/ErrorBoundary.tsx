import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack?: string } | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    this.setState({ errorInfo });
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-50 font-sans overflow-y-auto">
          <div className="max-w-md w-full bg-white rounded-[2rem] p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-3xl select-none">
              😵
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Что-то пошло не так
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              После обновления портала могла сброситься сессия. Попробуйте перезагрузить страницу.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-6 py-3 bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-sm border border-slate-800 cursor-pointer"
            >
              🔄 Обновить страницу
            </button>
            {this.state.error && (
              <details className="w-full mt-2 text-left text-[10px] text-slate-400 font-mono border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                  Технические детали
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-[10px] text-rose-600 leading-relaxed max-h-32 overflow-y-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
