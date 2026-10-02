import { Component, ReactNode } from 'react';
import ErrorPage from './components/common/ErrorPage';
import { reportAppError } from './utils/appErrors';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack?: string } | null;
}

/**
 * Общий экран «Что-то пошло не так».
 *
 * Пользователю показывается только понятное объяснение и действия.
 * Stack trace и внутренние пути остаются в консоли и показываются в интерфейсе
 * только в dev-режиме (ErrorPage сам проверяет import.meta.env.DEV).
 */
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
    // Подробности — в журнал, не в интерфейс
    console.error('Uncaught error:', error, errorInfo);
    // Падение рендера — критическое событие: попадает в appErrors и к дежурному.
    reportAppError({
      scope: 'render',
      severity: 'critical',
      message: `${error.name}: ${error.message}`,
      detail: errorInfo?.componentStack || undefined,
    });
  }

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      return (
        <ErrorPage
          code="generic"
          onRetry={() => window.location.reload()}
          onHome={() => { window.location.hash = '#dashboard'; window.location.reload(); }}
          devDetails={error ? `${error.name}: ${error.message}\n${errorInfo?.componentStack || ''}` : undefined}
        />
      );
    }
    return this.props.children;
  }
}
