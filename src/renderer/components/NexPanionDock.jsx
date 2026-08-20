import React, { useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { askNexPanion, NEXPANION_ID } from '../lib/nexpanion.js';

const WELCOME = {
  id: 'nexpanion-welcome',
  role: 'assistant',
  body: "Hey — I'm NexForge AI. Ask me anything. I'm especially sharp on gaming tips, ranked climb, comps, and NexForge itself.",
};

function timeLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function NexPanionDock() {
  const { user, guestMode, showToast, reportCloudError } = useNexForge();
  const myId = user?.id;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([WELCOME]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!myId) {
      setMsgs([WELCOME]);
      setReady(false);
      return;
    }
    setReady(false);
    try {
      const raw = localStorage.getItem(`nexpanion-chat:${myId}`);
      if (!raw) {
        setMsgs([WELCOME]);
      } else {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          setMsgs(parsed.map((m) => ({
            id: m.id,
            role: m.role || (m.sender_id === NEXPANION_ID ? 'assistant' : 'user'),
            body: m.body,
            created_at: m.created_at,
          })));
        } else {
          setMsgs([WELCOME]);
        }
      }
    } catch {
      setMsgs([WELCOME]);
    }
    setReady(true);
  }, [myId]);

  useEffect(() => {
    if (!myId || !ready) return;
    try {
      localStorage.setItem(`nexpanion-chat:${myId}`, JSON.stringify(msgs.slice(-80)));
    } catch { /* ignore */ }
  }, [msgs, myId, ready]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs, open, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    const userMsg = {
      id: `np-u-${Date.now()}`,
      role: 'user',
      body,
      created_at: new Date().toISOString(),
    };
    setMsgs((prev) => [...prev, userMsg]);
    try {
      const history = msgs
        .filter((m) => m.id !== 'nexpanion-welcome' && m.body)
        .slice(-16)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.body,
        }));
      const reply = await askNexPanion(body, history);
      setMsgs((prev) => [
        ...prev,
        {
          id: `np-a-${Date.now()}`,
          role: 'assistant',
          body: reply,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      showToast(err?.message || 'NexForge AI failed to reply.', 'error');
      await reportCloudError(err);
    } finally {
      setSending(false);
    }
  }

  if (!user || guestMode) return null;

  return (
    <div className={`np-dock ${open ? 'open' : ''}`}>
      {open && (
        <section className="np-panel" role="dialog" aria-label="NexForge AI">
          <header className="np-head">
            <div className="np-head-mark" aria-hidden>AI</div>
            <div className="np-head-copy">
              <div className="np-head-title">NexForge AI</div>
              <div className="np-head-sub">Gaming tips · ranked · the app</div>
            </div>
            <button
              type="button"
              className="np-icon-btn"
              title="Clear chat"
              onClick={() => setMsgs([WELCOME])}
            >
              Clear
            </button>
            <button
              type="button"
              className="np-icon-btn np-close"
              title="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="np-messages" ref={scrollRef}>
            {msgs.map((m) => (
              <div key={m.id} className={`np-msg ${m.role === 'user' ? 'mine' : ''}`}>
                <div className="np-bubble">
                  <div className="np-body">{m.body}</div>
                  {m.created_at && <div className="np-time">{timeLabel(m.created_at)}</div>}
                </div>
              </div>
            ))}
            {sending && (
              <div className="np-msg">
                <div className="np-bubble thinking">Thinking…</div>
              </div>
            )}
          </div>
          <div className="np-composer">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={2000}
              placeholder="Ask NexForge AI…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            />
            <button
              type="button"
              className="action-btn primary"
              disabled={sending || !draft.trim()}
              onClick={send}
            >
              Send
            </button>
          </div>
        </section>
      )}
      <button
        type="button"
        className={`np-fab ${open ? 'active' : ''}`}
        title={open ? 'Close NexForge AI' : 'Open NexForge AI'}
        aria-label={open ? 'Close NexForge AI' : 'Open NexForge AI'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : 'AI'}
      </button>
    </div>
  );
}
