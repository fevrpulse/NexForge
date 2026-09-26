import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

function missingSquadRpc(err) {
  return /could not find the function|schema cache|404|not found|post_squad|list_squad_posts|accept_squad_post|close_squad_post/i
    .test(String(err?.message || ''));
}

function memberLine(members) {
  const tags = (members || []).map((m) => m.gamer_tag).filter(Boolean);
  if (!tags.length) return 'No one has accepted yet';
  return `Accepted by ${tags.join(', ')}`;
}

export default function Squad() {
  const { user, showToast, reportCloudError } = useNexForge();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  const loadPosts = useCallback(async () => {
    if (!user?.id) {
      setPosts([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await sb.rpc('list_squad_posts');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      setPosts(rows);
      setLoadError(null);
      setRpcMissing(false);
    } catch (err) {
      setPosts([]);
      setRpcMissing(missingSquadRpc(err));
      setLoadError(
        missingSquadRpc(err)
          ? 'Run v162-squad-posts.sql in Supabase so squad posts can be shared.'
          : (err?.message || 'Could not load squad posts.'),
      );
      await reportCloudError?.(err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, reportCloudError]);

  useEffect(() => {
    loadPosts();
    if (!user?.id || rpcMissing) return undefined;
    const timer = setInterval(loadPosts, 15000);
    return () => clearInterval(timer);
  }, [loadPosts, user?.id, rpcMissing]);

  async function postSquad() {
    if (!user?.id || posting) return;
    const nextTitle = title.trim();
    const nextDetails = details.trim();
    if (!nextTitle || !nextDetails) {
      showToast('Enter a title and the details of the squad you want.', 'error');
      return;
    }
    setPosting(true);
    try {
      const { error } = await sb.rpc('post_squad', {
        p_title: nextTitle,
        p_details: nextDetails,
      });
      if (error) throw error;
      setTitle('');
      setDetails('');
      showToast('Squad posted', 'success');
      await loadPosts();
    } catch (err) {
      showToast(
        missingSquadRpc(err)
          ? 'Run v162-squad-posts.sql in Supabase so squad posts can be shared.'
          : (err?.message || 'Could not post squad.'),
        'error',
      );
      await reportCloudError?.(err);
    } finally {
      setPosting(false);
    }
  }

  async function acceptSquad(id) {
    if (!user?.id || busyId) return;
    setBusyId(id);
    try {
      const { error } = await sb.rpc('accept_squad_post', { p_post_id: id });
      if (error) throw error;
      showToast('You accepted this squad', 'success');
      await loadPosts();
    } catch (err) {
      showToast(err?.message || 'Could not accept squad.', 'error');
      await reportCloudError?.(err);
    } finally {
      setBusyId(null);
    }
  }

  async function closeSquad(id) {
    if (!user?.id || busyId) return;
    setBusyId(id);
    try {
      const { error } = await sb.rpc('close_squad_post', { p_post_id: id });
      if (error) throw error;
      showToast('Squad post closed', 'success');
      await loadPosts();
    } catch (err) {
      showToast(err?.message || 'Could not close squad post.', 'error');
      await reportCloudError?.(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Want a squad</div>
        <div className="field">
          <label>Title</label>
          <input
            type="text"
            maxLength={80}
            placeholder="e.g. Need a ranked stack tonight"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Details</label>
          <textarea
            maxLength={600}
            placeholder="Game, roles, rank, platform, and when you want to play."
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          This posts to the public board. Other players can accept it.
        </div>
        <button className="action-btn primary" onClick={postSquad} disabled={posting || !user?.id}>
          {posting ? 'Posting…' : 'Post squad'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Public squads</div>
        {loading ? (
          <div className="squad-empty">Loading squad posts…</div>
        ) : loadError ? (
          <div className="squad-empty">{loadError}</div>
        ) : posts.length === 0 ? (
          <div className="squad-empty">No public squads yet. Post one above.</div>
        ) : (
          posts.map((post) => (
            <div className="squad-post" key={post.id}>
              <div className="squad-post-title">{post.title}</div>
              <div className="squad-post-details">{post.details}</div>
              <div className="squad-post-meta">
                {post.host_tag || 'Player'}
                {post.is_host ? ' · your post' : ''}
                <br />
                {memberLine(post.members)}
              </div>
              <div className="squad-post-actions">
                {post.is_host ? (
                  <button
                    className="action-btn ghost"
                    disabled={busyId === post.id}
                    onClick={() => closeSquad(post.id)}
                  >
                    {busyId === post.id ? 'Closing…' : 'Close post'}
                  </button>
                ) : post.accepted ? (
                  <button className="action-btn ghost" disabled>Accepted</button>
                ) : (
                  <button
                    className="action-btn primary"
                    disabled={busyId === post.id}
                    onClick={() => acceptSquad(post.id)}
                  >
                    {busyId === post.id ? 'Accepting…' : 'Accept'}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
