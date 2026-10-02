import React from 'react';

interface PageLoadingProps {
  text?: string;
  fullScreen?: boolean;
}

export default function PageLoading({ text = 'Загрузка...', fullScreen = false }: PageLoadingProps) {
  return (
    <div className={`w-full flex flex-col items-center justify-center gap-5 select-none ${fullScreen ? 'min-h-screen' : 'min-h-[60vh]'}`} role="status" aria-label={text}>
      {/* Animated logo */}
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-white border border-[#E5E7EB] flex items-center justify-center shadow-xs">
          <span className="text-xl font-extrabold text-[#121316] tracking-tight">R</span>
        </div>
        <span className="absolute -bottom-1 -right-1 w-4 h-4">
          <span className="absolute inset-0 rounded-full bg-[#121316] animate-ping opacity-20" />
          <span className="absolute inset-0.5 rounded-full bg-[#121316]" />
        </span>
      </div>

      {/* Pulsing dots */}
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>

      <span className="text-xs font-medium text-[#9CA3AF] tracking-wide">{text}</span>
    </div>
  );
}