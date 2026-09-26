import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
import './styles/react.css';
import './styles/fx.css';

function markAppIdle() {
  const idle = document.hidden || !document.hasFocus();
  document.documentElement.toggleAttribute('data-app-idle', idle);
}
document.addEventListener('visibilitychange', markAppIdle);
window.addEventListener('blur', markAppIdle);
window.addEventListener('focus', markAppIdle);
markAppIdle();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
