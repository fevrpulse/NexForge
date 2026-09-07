/** Friend-only queues reuse the duels.server column so we don't need a new DB field. */
export const FRIEND_QUEUE_PREFIX = 'nf-friend:';

export function friendQueueServer(friendId) {
  return `${FRIEND_QUEUE_PREFIX}${friendId}`;
}

export function friendQueueTarget(server) {
  const s = String(server || '');
  if (!s.startsWith(FRIEND_QUEUE_PREFIX)) return null;
  return s.slice(FRIEND_QUEUE_PREFIX.length) || null;
}

export function isVisibleOpenQueue(duel, myId) {
  const target = friendQueueTarget(duel?.server);
  if (!target) return true;
  return target === myId || duel?.host_id === myId;
}

export function publicServerLabel(server) {
  if (friendQueueTarget(server)) return null;
  return server || null;
}
