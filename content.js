

const PROCESSED_ATTR = 'data-rmp-processed';
const INSTRUCTOR_SEL  = 'div.rightnclear[title="Instructor(s)"]';

// RMP fetch 

const pendingCallbacks = new Map(); 
const rmpCache = new Map();

function fetchRMP(name) {
  if (rmpCache.has(name)) return Promise.resolve(rmpCache.get(name));

  if (pendingCallbacks.has(name)) {
    return new Promise(resolve => pendingCallbacks.get(name).push(resolve));
  }

  pendingCallbacks.set(name, []);

  return new Promise((resolve, reject) => {
    pendingCallbacks.get(name).push(resolve);

    chrome.runtime.sendMessage({ type: 'RMP_FETCH', name }, response => {
      const waiters = pendingCallbacks.get(name) ?? [];
      pendingCallbacks.delete(name);

      if (chrome.runtime.lastError) {
        console.error('[McGill Better VSB] Runtime error:', chrome.runtime.lastError.message);
        rmpCache.set(name, null);
        waiters.forEach(fn => fn(null));
        return;
      }

      if (!response?.ok) {
        console.warn('[McGill Better VSB] Bad response for', name, response);
        rmpCache.set(name, null);
        waiters.forEach(fn => fn(null));
        return;
      }

      console.log('[McGill Better VSB] Got data for', name, response.data);
      rmpCache.set(name, response.data);
      waiters.forEach(fn => fn(response.data));
    });
  });
}

// Rendering

function ratingColor(r) {
  if (r >= 4)   return { bg: '#d1fae5', fg: '#065f46' };
  if (r >= 3)   return { bg: '#fef3c7', fg: '#92400e' };
  return              { bg: '#fee2e2', fg: '#991b1b' };
}

function buildBadges(data) {
  if (!data) return null;

  const wrap = document.createElement('span');
  wrap.className = 'rmp-badges';
  wrap.setAttribute('data-rmp-id', data.id ?? '');

  const { bg, fg } = ratingColor(data.avgRating);

  if (data.avgRating != null) {
    const rating = document.createElement('span');
    rating.className = 'rmp-chip rmp-rating';
    rating.style.background = bg;
    rating.style.color = fg;
    rating.textContent = data.avgRating.toFixed(1);
    wrap.appendChild(rating);
  }
  if (data.avgDifficulty != null) {
    const diff = document.createElement('span');
    diff.className = 'rmp-chip rmp-difficulty';
    diff.textContent = data.avgDifficulty.toFixed(1);
    wrap.appendChild(diff);
  }

  if (data.wouldTakeAgainPercent >= 0) {
    const wta = document.createElement('span');
    wta.className = 'rmp-chip rmp-again';
    wta.textContent = `${Math.round(data.wouldTakeAgainPercent)}% again`;
    wrap.appendChild(wta);
  }

  const isMcgill = data.source === 'mcgill.courses';
  const viewBtn  = document.createElement('button');
  viewBtn.className = isMcgill ? 'rmp-view-btn rmp-view-btn--mcgill' : 'rmp-view-btn rmp-view-btn--rmp';
  viewBtn.textContent = isMcgill ? 'View mcgill.courses stats' : 'View RMP stats';
  viewBtn.title = isMcgill
    ? `View ${data.firstName} ${data.lastName} on mcgill.courses`
    : `View ${data.firstName} ${data.lastName} on RateMyProfessors`;
  viewBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openPanel(data); });
  wrap.appendChild(viewBtn);

  return wrap;
}

// right panel

let panelEl   = null;
let backdropEl = null;

function openPanel(data) {
  closePanel();

  const backdrop = document.createElement('div');
  backdrop.className = 'rmp-backdrop';
  backdrop.addEventListener('click', closePanel);
  document.body.appendChild(backdrop);
  backdropEl = backdrop;

  const panel = document.createElement('div');
  panel.className = 'rmp-panel';
  panel.innerHTML = data.source === 'mcgill.courses'
    ? buildMcGillPanelHTML(data)
    : buildPanelHTML(data);
  panel.querySelector('.rmp-panel-close')?.addEventListener('click', e => {
    e.stopPropagation();
    closePanel();
  });
  panel.addEventListener('click', e => e.stopPropagation());

  document.body.appendChild(panel);
  panelEl = panel;
}

function closePanel() {
  panelEl?.remove();
  backdropEl?.remove();
  panelEl    = null;
  backdropEl = null;
}


// mcgill.courses panel is seperate with different listings

function buildMcGillPanelHTML(data) {
  const { bg, fg } = ratingColor(data.avgRating ?? 0);
  const profileUrl = `https://mcgill.courses/professors/${encodeURIComponent(`${data.firstName} ${data.lastName}`)}`;

  const reviewsHTML = (data.ratings ?? []).length
    ? data.ratings.map(r => {
        const date  = r.date ? new Date(r.date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' }) : '';
        const stars = r.helpful ? '★'.repeat(Math.round(r.helpful)) + '☆'.repeat(5 - Math.round(r.helpful)) : '';
        return `
          <div class="rmp-review">
            <div class="rmp-review-meta">
              <span class="rmp-review-course">${escapeHtml(r.course || '')}</span>
              <span class="rmp-review-stars">${stars}</span>
              <span class="rmp-review-date">${date}</span>
            </div>
            ${r.comment ? `<p class="rmp-review-comment">${escapeHtml(r.comment)}</p>` : ''}
          </div>
        `;
      }).join('')
    : '<p style="color:#9ca3af;font-size:13px;padding:8px 0">No reviews found.</p>';

  return `
    <div class="rmp-panel-header">
      <div>
        <div class="rmp-panel-name">${escapeHtml(data.firstName)} ${escapeHtml(data.lastName)}</div>
        <a class="rmp-panel-link rmp-panel-link--mcgill" href="${profileUrl}" target="_blank" rel="noopener">
          View on mcgill.courses ↗
        </a>
      </div>
      <button class="rmp-panel-close" title="Close">✕</button>
    </div>

    <div class="rmp-panel-stats">
      ${data.avgRating != null ? `
      <div class="rmp-stat">
        <div class="rmp-stat-value" style="background:${bg};color:${fg}">${data.avgRating.toFixed(1)}</div>
        <div class="rmp-stat-label">Rating</div>
      </div>` : ''}
      ${data.avgDifficulty != null ? `
      <div class="rmp-stat">
        <div class="rmp-stat-value">${data.avgDifficulty.toFixed(1)}</div>
        <div class="rmp-stat-label">Difficulty</div>
      </div>` : ''}
      <div class="rmp-stat">
        <div class="rmp-stat-value rmp-stat-small">${data.numRatings ?? 0}</div>
        <div class="rmp-stat-label">Reviews</div>
      </div>
    </div>

    <div class="rmp-source-notice">
      Reviews sourced from <a href="https://mcgill.courses" target="_blank" rel="noopener">mcgill.courses</a> community data.
    </div>

    <div class="rmp-panel-reviews-title">Reviews</div>
    <div class="rmp-panel-reviews">${reviewsHTML}</div>
  `;
}


function buildPanelHTML(data) {
  const { bg, fg } = ratingColor(data.avgRating);
  const rmpUrl = data.id
    ? `https://www.ratemyprofessors.com/professor/${atob(data.id).replace('Teacher-', '')}`
    : `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent((data.firstName ?? '') + ' ' + (data.lastName ?? ''))}`;

  const reviewsHTML = data.ratings.length
    ? data.ratings.map(r => {
        const date  = r.date ? new Date(r.date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' }) : '';
        const stars = r.helpful ? '★'.repeat(Math.round(r.helpful)) + '☆'.repeat(5 - Math.round(r.helpful)) : '';
        return `
          <div class="rmp-review">
            <div class="rmp-review-meta">
              <span class="rmp-review-course">${escapeHtml(r.course || '')}</span>
              <span class="rmp-review-stars">${stars}</span>
              <span class="rmp-review-date">${date}</span>
            </div>
            ${r.comment ? `<p class="rmp-review-comment">${escapeHtml(r.comment)}</p>` : ''}
          </div>
        `;
      }).join('')
    : '<p style="color:#9ca3af;font-size:13px;padding:8px 0">No reviews yet.</p>';

  return `
    <div class="rmp-panel-header">
      <div>
        <div class="rmp-panel-name">${escapeHtml(data.firstName)} ${escapeHtml(data.lastName)}</div>
        ${data.source === 'mcgill.courses'
          ? `<span class="rmp-source-badge rmp-source-mcgill">mcgill.courses reviews</span>`
          : `<a class="rmp-panel-link" href="${rmpUrl}" target="_blank" rel="noopener">View on RateMyProfessors ↗</a>`
        }
      </div>
      <button class="rmp-panel-close" title="Close">✕</button>
    </div>

    <div class="rmp-panel-stats">
      ${data.avgRating != null ? `
      <div class="rmp-stat">
        <div class="rmp-stat-value" style="background:${bg};color:${fg}">${data.avgRating.toFixed(1)}</div>
        <div class="rmp-stat-label">Rating</div>
      </div>` : ''}
      ${data.avgDifficulty != null ? `
      <div class="rmp-stat">
        <div class="rmp-stat-value">${data.avgDifficulty.toFixed(1)}</div>
        <div class="rmp-stat-label">Difficulty</div>
      </div>` : ''}
      ${data.wouldTakeAgainPercent >= 0 ? `
      <div class="rmp-stat">
        <div class="rmp-stat-value">${Math.round(data.wouldTakeAgainPercent)}%</div>
        <div class="rmp-stat-label">Again</div>
      </div>` : ''}
      <div class="rmp-stat">
        <div class="rmp-stat-value rmp-stat-small">${data.numRatings}</div>
        <div class="rmp-stat-label">Ratings</div>
      </div>
    </div>

    <div class="rmp-panel-reviews-title">Recent Reviews</div>
    <div class="rmp-panel-reviews">${reviewsHTML}</div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function injectInstructor(div) {
  if (div.getAttribute(PROCESSED_ATTR)) return;
  div.setAttribute(PROCESSED_ATTR, '1');

  const raw = div.textContent.trim();
  if (!raw || raw === 'TBA') return;

  const names = raw.split(';').map(n => n.trim()).filter(Boolean);

  div.textContent = '';

  for (const name of names) {
    const row = document.createElement('span');
    row.className = 'rmp-instructor-row';
    row.textContent = name;

    const loader = document.createElement('span');
    loader.className = 'rmp-chip rmp-loading';
    loader.textContent = 'RMP…';
    row.appendChild(loader);

    row.addEventListener('mouseenter', e => e.stopPropagation());
    row.addEventListener('mouseleave', e => e.stopPropagation());
    row.addEventListener('mousedown',  e => { e.stopPropagation(); e.stopImmediatePropagation(); });

    div.appendChild(row);

    fetchRMP(name).then(data => {
      loader.remove();
      if (data) {
        const badges = buildBadges(data);
        if (badges) row.appendChild(badges);
      } else {
        const notFound = document.createElement('span');
        notFound.className = 'rmp-chip rmp-not-found';
        notFound.textContent = 'No professor account found';
        row.appendChild(notFound);
      }
    });
  }
}

// Extension adds instructor divs when a course is looked up. Only specific elemenets are looked up for less delay

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      if (node.matches(INSTRUCTOR_SEL)) {
        injectInstructor(node);
        continue;
      }
      node.querySelectorAll(INSTRUCTOR_SEL).forEach(injectInstructor);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// moves stuff around for better visibiliyu

function fixSectionRow(table) {
  if (table.dataset.rmpRowFixed) return;
  table.dataset.rmpRowFixed = '1';

  const firstRow = table.querySelector('tbody tr:first-child');
  if (!firstRow) return;

  const tds = firstRow.querySelectorAll(':scope > td');
  if (tds.length < 3) return;

  const lectTd = tds[1];  
  const profTd = tds[2];  
  lectTd.querySelectorAll('[style*="float"]').forEach(el => el.style.removeProperty('float'));

  const campus  = profTd.querySelector('.campus_block');
  const locWrap = profTd.querySelector('.location_block')?.closest('div');
  const credits = profTd.querySelector('.credits_block');
  for (const el of [campus, locWrap, credits]) {
    if (el) lectTd.appendChild(el);
  }

  const notesCells  = table.querySelectorAll('tbody tr:nth-child(2) td');
  const notesCell   = notesCells.length ? notesCells[notesCells.length - 1] : null;
  const courseBox   = table.closest('.course_box');
  const courseHeader = courseBox?.querySelector('.course_header');

  if (courseHeader && notesCell) {
    const notes = [...notesCell.querySelectorAll('.leftnclear')].filter(el => el.textContent.trim());
    if (notes.length) {
      const wrap = document.createElement('div');
      wrap.className = 'vsb-notes-in-header';
      notes.forEach(n => {
        const line = document.createElement('div');
        line.className = 'vsb-note-line';
        line.textContent = n.textContent.trim();
        wrap.appendChild(line);
      });
      courseHeader.appendChild(wrap);
      const notesRow2 = notesCell.closest('tr');
      if (notesRow2) notesRow2.style.display = 'none';
    }
  }
}

function fixAllSectionRows(root) {
  (root || document).querySelectorAll('.inner_legend_table').forEach(fixSectionRow);
}

fixAllSectionRows();

const rowFixObs = new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches('.inner_legend_table')) { fixSectionRow(node); continue; }
      node.querySelectorAll('.inner_legend_table').forEach(fixSectionRow);
    }
  }
});
rowFixObs.observe(document.body, { childList: true, subtree: true });


(function applyVSBLayout() {
  const CRITERIA_W = '26%';
  const RESULTS_W  = '72%';

  function fixWidths() {
    const criteria = document.getElementById('page_criteria');
    const results  = document.getElementById('page_results');
    if (criteria && criteria.style.width && criteria.style.width !== CRITERIA_W) {
      criteria.style.setProperty('width', CRITERIA_W, 'important');
    }
    if (results && results.style.width && results.style.width !== RESULTS_W) {
      results.style.setProperty('width', RESULTS_W, 'important');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixWidths);
  } else {
    fixWidths();
  }

  const layoutObs = new MutationObserver(fixWidths);
  function attachLayoutObs() {
    const criteria = document.getElementById('page_criteria');
    const results  = document.getElementById('page_results');
    if (criteria) layoutObs.observe(criteria, { attributes: true, attributeFilter: ['style'] });
    if (results)  layoutObs.observe(results,  { attributes: true, attributeFilter: ['style'] });
  }

  if (document.getElementById('page_criteria')) {
    attachLayoutObs();
  } else {
    // Wait until VSB renders the panels
    const waitObs = new MutationObserver(() => {
      if (document.getElementById('page_criteria')) {
        attachLayoutObs();
        fixWidths();
        waitObs.disconnect();
      }
    });
    waitObs.observe(document.body, { childList: true, subtree: true });
  }
})();

// theme picker

const DEFAULT_COLORS = ['#4f86c6', '#e8804a', '#5db37e', '#b36ac2', '#e05c5c'];
const STORAGE_KEY    = 'vsb_theme_colors';

function darkenHex(hex, frac = 0.18) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const k = 1 - frac;
  return '#' + [r, g, b].map(c => Math.round(c * k).toString(16).padStart(2, '0')).join('');
}

function needsWhiteText(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // this stuff is to decide if the text color should change due to a dark bg
  return (r * 299 + g * 587 + b * 114) / 1000 < 145;
}

function applyThemeColors(colors) {
  let el = document.getElementById('vsb-theme-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'vsb-theme-style';
    document.head.appendChild(el);
  }

  const criteriaReset = Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    return `
      /* In Select Courses panel: revert card border/background/text,
         but keep .cbox-cn (the course-code square) colored. */
      #page_criteria .bd${n} { border-color: revert !important; background-color: revert !important; color: revert !important; }
      #page_criteria .bd${n} *:not(.cbox-cn) { color: revert !important; }
    `;
  }).join('\n');

  el.textContent = colors.map((hex, i) => {
    const n         = i + 1;
    const dark      = darkenHex(hex);
    const textColor = needsWhiteText(hex)      ? '#ffffff' : 'revert';
    const darkText  = needsWhiteText(dark)     ? '#ffffff' : 'revert';
    return `
      .bc${n}, .bh${n} { background-color: ${hex}  !important; color: ${textColor} !important; }
      .bc${n} *, .bh${n} * { color: ${textColor} !important; }
      .bd${n}           { background-color: ${dark} !important; border-color: ${dark} !important;
                          color: ${darkText} !important; }
      .bd${n} *         { color: ${darkText} !important; }
      .bg_${['green','blue','orange','purple','red'][i]} { background-color: ${hex} !important; }
    `;
  }).join('\n') + '\n' + criteriaReset;
}

function initThemePicker() {
  if (document.getElementById('vsb-theme-btn')) return;

  
  const btn = document.createElement('button');
  btn.id        = 'vsb-theme-btn';
  btn.title     = 'Customise course colours';
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746
             1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125
             a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503
             5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
  </svg> Colours`;
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'vsb-theme-panel';

  const backdrop = document.createElement('div');
  backdrop.id = 'vsb-theme-backdrop';
  backdrop.addEventListener('click', closeThemePanel);
  document.body.appendChild(backdrop);

  function openThemePanel()  {
    panel.classList.add('vsb-theme-open');
    backdrop.classList.add('vsb-theme-open');
  }
  function closeThemePanel() {
    panel.classList.remove('vsb-theme-open');
    backdrop.classList.remove('vsb-theme-open');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.contains('vsb-theme-open') ? closeThemePanel() : openThemePanel();
  });

  chrome.storage.local.get(STORAGE_KEY, result => {
    const colors = (result[STORAGE_KEY] && result[STORAGE_KEY].length === 5)
      ? result[STORAGE_KEY]
      : [...DEFAULT_COLORS];

    applyThemeColors(colors);
    buildPanel(colors);
  });

  function buildPanel(colors) {
    panel.innerHTML = `
      <div class="vsb-tp-header">
        <span class="vsb-tp-title">Course Colours</span>
        <button class="vsb-tp-close" id="vsb-tp-close-btn">✕</button>
      </div>
      <div class="vsb-tp-rows">
        ${colors.map((hex, i) => `
          <div class="vsb-tp-row" data-index="${i}">
            <div class="vsb-tp-swatch" id="vsb-swatch-${i}" style="background:${hex}"></div>
            <span class="vsb-tp-label">Course ${i + 1}</span>
            <div class="vsb-tp-inputs">
              <input class="vsb-tp-hex" id="vsb-hex-${i}" type="text"
                     maxlength="7" value="${hex}" spellcheck="false">
              <input class="vsb-tp-color" id="vsb-color-${i}" type="color" value="${hex}">
            </div>
          </div>
        `).join('')}
      </div>
      <div class="vsb-tp-footer">
        <button class="vsb-tp-reset" id="vsb-tp-reset">Reset</button>
        <button class="vsb-tp-save"  id="vsb-tp-save">Apply</button>
      </div>
    `;

    document.body.appendChild(panel);

    document.getElementById('vsb-tp-close-btn').addEventListener('click', closeThemePanel);

    colors.forEach((_, i) => {
      const hexInput   = document.getElementById(`vsb-hex-${i}`);
      const colorInput = document.getElementById(`vsb-color-${i}`);
      const swatch     = document.getElementById(`vsb-swatch-${i}`);

      colorInput.addEventListener('input', () => {
        hexInput.value  = colorInput.value;
        swatch.style.background = colorInput.value;
      });

      hexInput.addEventListener('input', () => {
        const v = hexInput.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          colorInput.value = v;
          swatch.style.background = v;
        }
      });
    });

    document.getElementById('vsb-tp-save').addEventListener('click', () => {
      const saved = Array.from({ length: 5 }, (_, i) => {
        const v = document.getElementById(`vsb-hex-${i}`).value.trim();
        return /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_COLORS[i];
      });
      chrome.storage.local.set({ [STORAGE_KEY]: saved });
      applyThemeColors(saved);
      const saveBtn = document.getElementById('vsb-tp-save');
      saveBtn.textContent = 'Saved ✓';
      setTimeout(() => { saveBtn.textContent = 'Apply'; }, 1400);
    });

    document.getElementById('vsb-tp-reset').addEventListener('click', () => {
      DEFAULT_COLORS.forEach((hex, i) => {
        document.getElementById(`vsb-hex-${i}`).value   = hex;
        document.getElementById(`vsb-color-${i}`).value = hex;
        document.getElementById(`vsb-swatch-${i}`).style.background = hex;
      });
    });
  }
}

// Waits for the page to be ready before inserting the picker
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initThemePicker);
} else {
  initThemePicker();
}

// export buttons

const EXPORT_FORMATS = [
  { key: 'square',  label: 'Square',  sub: '1080 × 1080', w: 1080, h: 1080 },
  { key: 'phone',   label: 'Phone',   sub: '1080 × 1920', w: 1080, h: 1920 },
  { key: 'desktop', label: 'Desktop', sub: '1920 × 1080', w: 1920, h: 1080 },
];

async function exportSchedule(fmt) {
  const scheduleEl = document.querySelector('.reg_schedule1');
  if (!scheduleEl || typeof html2canvas === 'undefined') return;

  const btn = document.getElementById(`vsb-export-btn-${fmt.key}`);
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {
    const srcCanvas = await html2canvas(scheduleEl, {
      useCORS: true,
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      ignoreElements: el => el.classList.contains('timesToAvoid') ||
                            el.classList.contains('bubbletitle')  ||
                            el.id === 'vsb-export-row',
    });

    const { w: tw, h: th } = fmt;
    const dst = document.createElement('canvas');
    dst.width  = tw;
    dst.height = th;
    const ctx  = dst.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);

    const PAD   = Math.round(Math.min(tw, th) * 0.05);
    const maxW  = tw - PAD * 2;
    const maxH  = th - PAD * 2;
    const scale = Math.min(maxW / srcCanvas.width, maxH / srcCanvas.height);
    const dw    = srcCanvas.width  * scale;
    const dh    = srcCanvas.height * scale;
    const dx    = (tw - dw) / 2;
    const dy    = (th - dh) / 2;

    ctx.drawImage(srcCanvas, dx, dy, dw, dh);

    const link    = document.createElement('a');
    link.download = `vsb-schedule-${fmt.key}.png`;
    link.href     = dst.toDataURL('image/png');
    link.click();
  } finally {
    if (btn) { btn.textContent = fmt.label; btn.disabled = false; }
  }
}

function injectExportButtons() {
  if (document.getElementById('vsb-export-row')) return;

  const dateGridHolder = document.querySelector('.reg_schedule1 .dateGridHolder');
  if (!dateGridHolder) return;

  const row = document.createElement('div');
  row.id = 'vsb-export-row';
  row.innerHTML = `
    <span class="vsb-export-label">Save as image</span>
    <div class="vsb-export-btns">
      ${EXPORT_FORMATS.map(f => `
        <button id="vsb-export-btn-${f.key}" class="vsb-export-btn">
          <span class="vsb-export-btn-label">${f.label}</span>
          <span class="vsb-export-btn-sub">${f.sub}</span>
        </button>
      `).join('')}
    </div>
  `;

  dateGridHolder.appendChild(row);

  EXPORT_FORMATS.forEach(f => {
    document.getElementById(`vsb-export-btn-${f.key}`)
      .addEventListener('click', () => exportSchedule(f));
  });
}

(function waitForSchedule() {
  if (document.querySelector('.reg_schedule1')) {
    injectExportButtons();
  }
  const obs = new MutationObserver(() => {
    if (document.querySelector('.reg_schedule1') && !document.getElementById('vsb-export-row')) {
      injectExportButtons();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();


function fixResultsHeader() {
  const resultsTop = document.querySelector('.results-top');
  const regRow1    = document.querySelector('.reg_row1');
  const regFlip    = document.querySelector('.reg_flip');
  if (!resultsTop || !regRow1 || !regFlip) return;
  if (resultsTop.dataset.rmpHeaderFixed) return;
  resultsTop.dataset.rmpHeaderFixed = '1';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'vsb-header-left';
  const legend = resultsTop.querySelector('.results-legend');
  const tips   = resultsTop.querySelector('.tips-button');
  if (legend) leftGroup.appendChild(legend);
  if (tips)   leftGroup.appendChild(tips);

  const rightGroup = document.createElement('div');
  rightGroup.className = 'vsb-header-right';
  const sort       = resultsTop.querySelector('.results-sort');
  const filter     = resultsTop.querySelector('.results-filter');
  const regFilter  = resultsTop.querySelector('.reg_filter');
  if (sort)      rightGroup.appendChild(sort);
  if (filter)    rightGroup.appendChild(filter);
  if (regFilter) rightGroup.appendChild(regFilter);

  resultsTop.innerHTML = '';
  resultsTop.appendChild(leftGroup);
  resultsTop.appendChild(regFlip);
  resultsTop.appendChild(rightGroup);

  regRow1.style.cssText += 'height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;min-height:0!important;';
}

(function waitForResultsHeader() {
  if (document.querySelector('.results-top .reg_flip') ||
      (document.querySelector('.results-top') && document.querySelector('.reg_flip'))) {
    fixResultsHeader();
  }
  const obs = new MutationObserver(() => {
    if (document.querySelector('.results-top') && document.querySelector('.reg_flip')) {
      fixResultsHeader();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
