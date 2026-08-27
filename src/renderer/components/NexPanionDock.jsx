import React, { useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { askNexPanion, NEXPANION_ID } from '../lib/nexpanion.js';

const WELCOME = {
  id: 'nexpanion-welcome',
  role: 'assistant',
  body: "Hey — I'm NexAI. Ask me anything. I'm especially sharp on gaming tips, warmups, comps, and NexForge itself.",
};

const SUGGESTIONS = [
  'Give me a 10-minute warmup',
  'How do I start a party?',
  'Tips after a losing streak',
];

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
    if (!user || guestMode) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'a') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, user, guestMode]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs, open, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text) {
    const body = String(text ?? draft).trim();
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
      setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
      setDraft(body);
      showToast(err?.message || 'NexAI failed to reply.', 'error');
      await reportCloudError(err);
    } finally {
      setSending(false);
    }
  }

  if (!user || guestMode) return null;

  const showSuggestions = !sending && msgs.every((m) => m.id === 'nexpanion-welcome' || m.role !== 'user');

  return (
    <div className={`np-dock ${open ? 'open' : ''}`}>
      {open && (
        <section className="np-panel" role="dialog" aria-label="NexAI">
          <header className="np-head">
            <div className="np-head-mark" aria-hidden>AI</div>
            <div className="np-head-copy">
              <div className="np-head-title">NexAI</div>
              <div className="np-head-sub">Gaming tips · Ctrl+Shift+A</div>
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
                <div className="np-bubble thinking">
                  <span className="np-dots" aria-hidden="true"><i /><i /><i /></span>
                  Thinking
                </div>
              </div>
            )}
          </div>
          {showSuggestions && (
            <div className="np-suggestions">
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="np-chip"
                  onClick={() => send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <div className="np-composer">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={2000}
              placeholder="Ask NexAI…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            />
            <button
              type="button"
              className="action-btn primary"
              disabled={sending || !draft.trim()}
              onClick={() => send()}
            >
              Send
            </button>
          </div>
        </section>
      )}
      <div className={`np-fab-wrap ${open ? 'open' : ''}`}>
        {!open && <span className="np-orbit" aria-hidden="true" />}
        <button
          type="button"
          className={`np-fab ${open ? 'active' : ''}`}
          title={open ? 'Close NexAI' : 'Open NexAI (Ctrl+Shift+A)'}
          aria-label={open ? 'Close NexAI' : 'Open NexAI'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '×' : 'AI'}
        </button>
      </div>
    </div>
  );
}
