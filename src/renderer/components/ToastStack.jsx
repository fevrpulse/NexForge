import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';

export default function ToastStack() {
  const { toasts } = useNexForge();

  if (!toasts.length) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item ${t.type}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
