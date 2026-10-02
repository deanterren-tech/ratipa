import React from 'react';
import ErrorPage from './ErrorPage';

interface NotFoundPageProps {
  onNavigate?: (module: string) => void;
}

/** 404: адрес module не соответствует ни одному разделу портала. */
export default function NotFoundPage({ onNavigate }: NotFoundPageProps) {
  return (
    <ErrorPage
      code={404}
      onHome={onNavigate ? () => onNavigate('dashboard') : undefined}
      onBack={() => window.history.back()}
    />
  );
}
