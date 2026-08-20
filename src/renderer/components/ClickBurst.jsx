import React, { useEffect, useRef, useState } from 'react';

let nextId = 1;

function makeSparks() {
  const n = 10;
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 16 + Math.random() * 28;
    return {
      i,
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist}px`,
    };
  });
}

export default function ClickBurst() {
  const [bursts, setBursts] = useState([]);
  const lampRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (media?.matches) return undefined;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let tx = x;
    let ty = y;
    let raf = 0;

    function tick() {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      if (lampRef.current) {
        lampRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);

    function onMove(e) {
      tx = e.clientX;
      ty = e.clientY;
    }

    function spawn(e) {
      const id = nextId++;
      const burst = { id, x: e.clientX, y: e.clientY, sparks: makeSparks() };
      setBursts((prev) => [...prev.slice(-9), burst]);
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 480);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', spawn);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', spawn);
    };
  }, []);

  return (
    <div className="click-fx-layer" aria-hidden="true">
      <span className="cursor-lamp" ref={lampRef} />
      {bursts.map((b) => (
        <span
          key={b.id}
          className="click-burst"
          style={{ left: b.x, top: b.y }}
        >
          <span className="click-ring" />
          <span className="click-hex" />
          <span className="click-core" />
          {b.sparks.map((s) => (
            <span
              key={s.i}
              className="click-spark"
              style={{ '--dx': s.dx, '--dy': s.dy }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}
