import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';

export default function ToastStack() {
  const { toasts, dismissToast } = useNexForge();

  if (!toasts.length) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast-item ${t.type}`}
          onClick={() => dismissToast?.(t.id)}
          title="Dismiss"
        >
          {t.msg}
        </button>
      ))}
    </div>
  );
}
