import React from 'react';
import ErrorPage from './ErrorPage';

interface ServerErrorPageProps {
  onRetry?: () => void;
  onNavigate?: (module: string) => void;
  /** Технические подробности — выводятся только в dev-режиме. */
  devDetails?: string;
}

/** 500: внутренняя ошибка сервера. Причину не подменяем на другую. */
export default function ServerErrorPage({ onRetry, onNavigate, devDetails }: ServerErrorPageProps) {
  return (
    <ErrorPage
      code={500}
      onRetry={onRetry}
      onHome={onNavigate ? () => onNavigate('dashboard') : undefined}
      devDetails={devDetails}
    />
  );
}
