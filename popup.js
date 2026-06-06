

'use strict';

const DB_KEY  = 'rmp_db';
const TS_KEY  = 'rmp_db_ts';

const STALE_MS = 7 * 24 * 60 * 60 * 1000; 


//readable
function timeAgo(epochMs) {
  const diff = Date.now() - epochMs;
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}


const dot   = document.getElementById('js-dot');
const label = document.getElementById('js-label');
const meta  = document.getElementById('js-meta');

// render status

chrome.storage.local.get([DB_KEY, TS_KEY], stored => {
  const db = stored[DB_KEY];
  const ts = stored[TS_KEY];

  if (!db) {
    dot.className   = 'status-dot status-dot--yellow';
    label.textContent = 'Downloading professor database…';
    meta.textContent  = 'Open VSB once the download completes';
    return;
  }

  const count   = Object.keys(db).length;
  const isStale = !ts || (Date.now() - ts) > STALE_MS;

  if (isStale) {
    dot.className     = 'status-dot status-dot--yellow';
    label.textContent = `${count.toLocaleString()} professors loaded`;
    meta.textContent  = `Last updated ${ts ? timeAgo(ts) : 'unknown'} · refresh pending`;
  } else {
    dot.className     = 'status-dot status-dot--green';
    label.textContent = `${count.toLocaleString()} professors loaded`;
    meta.textContent  = `Updated ${timeAgo(ts)}`;
  }
});
