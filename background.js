'use strict';

//  Constants 

const GITHUB_URL = 'https://raw.githubusercontent.com/GodOfTheFlies/mcgillexts/refs/heads/main/professors-ratings.json';

const DB_KEY  = 'rmp_db';   
const TS_KEY  = 'rmp_db_ts'; 

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; 

const S = 'p:';

let ratingsDB = undefined; // compact RMP data
let metaDB    = null; // professors.json
let mcgillDB  = null; // mcgill-reviews.json


async function loadBundled(filename) {
  try {
    const res = await fetch(chrome.runtime.getURL(filename));
    return res.ok ? res.json() : {};
  } catch {
    console.warn(`[Better VSB] Could not load bundled file: ${filename}`);
    return {};
  }
}


async function getRatingsDB() {
  if (ratingsDB !== undefined) return ratingsDB;
  const stored = await chrome.storage.local.get(DB_KEY);
  ratingsDB = stored[DB_KEY] ?? null;
  return ratingsDB;
}

async function getMetaDB() {
  if (metaDB !== null) return metaDB;
  metaDB = await loadBundled('professors.json');
  console.log(`[Better VSB] Meta DB ready — ${Object.keys(metaDB).length} entries`);
  return metaDB;
}

async function getMcGillDB() {
  if (mcgillDB !== null) return mcgillDB;
  mcgillDB = await loadBundled('mcgill-reviews.json');
  console.log(`[Better VSB] McGill DB ready — ${Object.keys(mcgillDB).length} entries`);
  return mcgillDB;
}


async function getSession(name) {
  const stored = await chrome.storage.session.get(S + name);
  return stored[S + name];
}

async function setSession(name, data) {
  await chrome.storage.session.set({ [S + name]: data ?? null });
}

// github fetch and chache

async function fetchAndCache() {
  console.log('[Better VSB] Fetching latest ratings from GitHub…');

  const res = await fetch(GITHUB_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub responded with HTTP ${res.status}`);
  const data = await res.json();
  await chrome.storage.local.set({ [DB_KEY]: data, [TS_KEY]: Date.now() });
  ratingsDB = data;

  try { await chrome.storage.session.clear(); } catch {  }

  console.log(`[Better VSB] Ratings DB cached — ${Object.keys(data).length} entries`);
}



async function refreshIfStale() {
  const stored = await chrome.storage.local.get([DB_KEY, TS_KEY]);

  const hasData     = stored[DB_KEY] != null;
  const lastUpdated = stored[TS_KEY] ?? 0;
  const isStale     = (Date.now() - lastUpdated) > MAX_AGE_MS;

  if (!hasData || isStale) {
    const reason = !hasData ? 'no cached data found' : 'cache is older than 7 days';
    console.log(`[Better VSB] Refreshing ratings DB (${reason})…`);
    await fetchAndCache();
  } else {
    ratingsDB = stored[DB_KEY];
    const age = Math.round((Date.now() - lastUpdated) / (1000 * 60 * 60));
    console.log(`[Better VSB] Ratings DB loaded from cache (age: ${age}h, ${Object.keys(ratingsDB).length} entries)`);
  }
}


chrome.runtime.onInstalled.addListener(() => {
  refreshIfStale().catch(err =>
    console.error('[Better VSB] onInstalled refresh failed:', err.message)
  );
});

chrome.runtime.onStartup.addListener(() => {
  refreshIfStale().catch(err =>
    console.error('[Better VSB] onStartup refresh failed:', err.message)
  );
});

// strips the names from specia characters and shortened names
function resolveKey(name, db) {
  if (db[name] !== undefined) return name;
  const short = name.replace(/,\s+(\S+)\s+\S\.?$/, ', $1').trim();
  if (short !== name && db[short] !== undefined) return short;
  return null;
}

// data shaping

// Expand the compact stored schema 
 
function expandRatings(key, compact, meta) {
  const commaIdx     = key.indexOf(', ');
  const fallbackLast  = commaIdx !== -1 ? key.slice(0, commaIdx)  : key;
  const fallbackFirst = commaIdx !== -1 ? key.slice(commaIdx + 2) : '';
  const m             = meta[key] ?? {};

  return {
    id:                    m.id         ?? null,
    firstName:             m.firstName  ?? fallbackFirst,
    lastName:              m.lastName   ?? fallbackLast,
    avgRating:             compact.r    ?? null,
    avgDifficulty:         compact.d    ?? null,
    wouldTakeAgainPercent: compact.t    ?? -1,
    numRatings:            compact.n    ?? 0,
    ratings: (compact.c ?? []).map(r => ({
      date:    r.d ?? null,
      course:  r.c ?? '',
      comment: r.m ?? '',
      grade:   r.g ?? '',
    })),
  };
}

// message handler

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'RMP_FETCH') return false;

  const name = msg.name;

  (async () => {

    
    const cached = await getSession(name);
    if (cached !== undefined) {
      return sendResponse({ ok: true, data: cached });
    }

    // gihtub rmp data
    const ratings = await getRatingsDB();

    if (ratings) {
      const key = resolveKey(name, ratings);
      if (key && (ratings[key].n ?? 0) > 0) {
        const meta = await getMetaDB();
        const data = expandRatings(key, ratings[key], meta);
        await setSession(name, data);
        return sendResponse({ ok: true, data });
      }
    } else {
      
      console.warn('[Better VSB] Ratings DB not ready — triggering background refresh');
      refreshIfStale().catch(() => {});
    }

    // mcgill courses data
    const mcgill = await getMcGillDB();
    if (mcgill) {
      const key = resolveKey(name, mcgill);
      if (key) {
        await setSession(name, mcgill[key]);
        return sendResponse({ ok: true, data: mcgill[key] });
      }
    }

    // not found either
    await setSession(name, null);
    sendResponse({ ok: true, data: null });

  })().catch(err => sendResponse({ ok: false, error: err.message }));

  return true; 
});
