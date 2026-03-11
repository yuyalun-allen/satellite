// Fetch and aggregate feeds from other users' sites

import * as crypto from './crypto.js';

const DEFAULT_BASE = 'satellite';

// Fetch profile, trying /satellite/satproto.json first, then /satproto.json.
export async function fetchProfile(domain) {
  const primary = await fetch(`https://${domain}/${DEFAULT_BASE}/satproto.json`);
  if (primary.ok) return primary.json();
  const fallback = await fetch(`https://${domain}/satproto.json`);
  if (fallback.ok) return fallback.json();
  throw new Error(`Profile not found for ${domain}`);
}

// Get the sat_root URL prefix for a user (e.g. "https://alice.com/satellite/sat")
async function getSatRoot(domain) {
  const profile = await fetchProfile(domain);
  if (profile.sat_root) {
    // sat_root can be absolute or relative
    if (profile.sat_root.startsWith('http')) {
      return { base: profile.sat_root.replace(/\/$/, ''), profile };
    }
    return { base: `https://${domain}${profile.sat_root}`.replace(/\/$/, ''), profile };
  }
  return { base: `https://${domain}/${DEFAULT_BASE}/sat`, profile };
}

export async function fetchFollowList(domain) {
  const { base } = await getSatRoot(domain);
  const resp = await fetch(`${base}/follows/index.json`);
  if (!resp.ok) throw new Error(`Follow list not found for ${domain}`);
  return resp.json();
}

export async function fetchPostIndex(domain) {
  const { base } = await getSatRoot(domain);
  const resp = await fetch(`${base}/posts/index.json`);
  if (!resp.ok) throw new Error(`Post index not found for ${domain}`);
  return resp.json();
}

async function fetchKeyEnvelope(satBase, myDomain, mySecret) {
  const resp = await fetch(`${satBase}/keys/${myDomain}.json`);
  if (!resp.ok) throw new Error(`No key envelope for ${myDomain}`);
  const envelope = await resp.json();
  const sealed = crypto.fromBase64(envelope.encrypted_key);
  return crypto.openContentKey(sealed, mySecret);
}

async function fetchPost(satBase, postId, contentKey) {
  const resp = await fetch(`${satBase}/posts/${postId}.json.enc`);
  if (!resp.ok) throw new Error(`Post ${postId} not found`);
  const encrypted = new Uint8Array(await resp.arrayBuffer());
  const decrypted = crypto.decryptData(encrypted, contentKey);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function fetchUserPosts(domain, myDomain, mySecret, limit = 50) {
  const { base } = await getSatRoot(domain);
  const contentKey = await fetchKeyEnvelope(base, myDomain, mySecret);
  const resp = await fetch(`${base}/posts/index.json`);
  if (!resp.ok) throw new Error(`Post index not found for ${domain}`);
  const index = await resp.json();
  const posts = [];
  for (const postId of index.posts.slice(0, limit)) {
    try {
      posts.push(await fetchPost(base, postId, contentKey));
    } catch (e) {
      console.warn(`Failed to fetch post ${postId} from ${domain}:`, e);
    }
  }
  return posts;
}

export function mergeFeed(postArrays) {
  return postArrays.flat().sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

export function filterReplies(posts, postId, postAuthor) {
  return posts.filter(
    (p) => p.reply_to === postId && p.reply_to_author === postAuthor
  );
}
