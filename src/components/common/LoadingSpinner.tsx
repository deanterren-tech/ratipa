import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: number;
  text?: string;
  className?: string;
}

export default function LoadingSpinner({ size = 16, text, className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Loader2 size={size} className="animate-spin text-[#9CA3AF]" strokeWidth={2} />
      {text && <span className="text-xs font-medium text-[#9CA3AF]">{text}</span>}
    </div>
  );
}