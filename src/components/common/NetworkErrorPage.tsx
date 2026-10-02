import React from 'react';
import ErrorPage from './ErrorPage';

interface NetworkErrorPageProps {
  onRetry?: () => void;
  /** Клик по «На главную» — если раздел можно открыть из кэша. */
  onHome?: () => void;
}

/** Недоступность сервиса / отсутствие соединения. */
export default function NetworkErrorPage({ onRetry, onHome }: NetworkErrorPageProps) {
  return <ErrorPage code="network" onRetry={onRetry} onHome={onHome} />;
}
