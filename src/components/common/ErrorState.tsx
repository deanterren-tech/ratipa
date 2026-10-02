import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import ErrorPage, { ErrorCode } from './ErrorPage';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
  /** Код ошибки — определяет объяснение и набор действий. */
  code?: ErrorCode;
}

/**
 * Ошибка внутри раздела. Компактный вариант — рядом с данными,
 * полный — как самостоятельный экран. Стиль общий с остальными экранами ошибок.
 */
export default function ErrorState({
  title,
  message,
  onRetry,
  compact = false,
  code = 500,
}: ErrorStateProps) {
  if (compact) {
    return <ErrorPage code={code} detail={message} onRetry={onRetry} compact />;
  }

  return (
    <ErrorPage
      code={code}
      detail={message}
      onRetry={onRetry}
      onHome={() => { window.location.hash = '#dashboard'; }}
      devDetails={title && title !== 'Ошибка загрузки' ? title : undefined}
    />
  );
}
