const DEFAULTS = {
  sidebar: true,
  topnav: true,
  fullscreen: false,
  linearView: false,
  linearDark: false,
  description: true,
  attachments: true,
  childissues: true,
  linkedissues: true,
  activity: true,
  details: true,
  development: true,
  morefields: true,
  automation: true,
  people: true,
  dates: true,
  timetracking: true,
  sprint: true,
  timestamps: true,
  contentWidth: 100,
  sideWidth: 100,
  spacing: 100,
  fontScale: 100,
  fontFamily: 'default'
};

const checkboxes = document.querySelectorAll('input[data-section]');
const sizingInputs = document.querySelectorAll('[data-sizing]');
const statusEl = document.getElementById('status');

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.className = 'status' + (kind ? ' status--' + kind : '');
}

function isJiraUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host.endsWith('.atlassian.net') ||
      host === 'login.jira.your-company.com' ||
      host.endsWith('.jira.your-company.com')
    );
  } catch (_) {
    return false;
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function ensureContentScript(tab) {
  if (!tab?.id || !isJiraUrl(tab.url || '')) {
    return { ok: false, reason: 'not-jira' };
  }

  let response = await sendToTab(tab.id, { type: 'JIRA_DECLUTTER_PING' });
  if (response?.ok) return { ok: true, injected: false };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css', 'linear-view.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js', 'linear-view.js']
    });
  } catch (err) {
    return { ok: false, reason: 'inject-failed', error: String(err) };
  }

  response = await sendToTab(tab.id, { type: 'JIRA_DECLUTTER_PING' });
  if (response?.ok) return { ok: true, injected: true };
  return { ok: false, reason: 'no-response' };
}

async function pushToActiveTab(state) {
  const tab = await getActiveTab();
  const ready = await ensureContentScript(tab);
  if (!ready.ok) {
    if (ready.reason === 'not-jira') {
      setStatus('Open your Jira tab, then try again.', 'warn');
    } else {
      setStatus('Couldn’t reach this page — refresh Jira and reopen.', 'warn');
    }
    return;
  }

  const response = await sendToTab(tab.id, { type: 'JIRA_DECLUTTER_UPDATE', state });
  if (!response?.ok) {
    setStatus('Saved, but page didn’t update — refresh Jira.', 'warn');
    return;
  }

  const href = tab.url || '';
  const onIssue = /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href) || /selectedIssue=/i.test(href);
  if (state.linearView && !onIssue) {
    setStatus('Linear view on — open an issue to see it.', 'info');
  } else if (!onIssue) {
    setStatus('Layout toggles work here. Open an issue for size & font.', 'info');
  } else if (state.linearView) {
    setStatus('Linear view active on this issue.', 'ok');
  } else {
    setStatus('Connected to Jira', 'ok');
  }
}

function collectState() {
  const state = { ...DEFAULTS };
  checkboxes.forEach((c) => {
    state[c.dataset.section] = c.checked;
  });
  sizingInputs.forEach((input) => {
    const key = input.dataset.sizing;
    if (input.type === 'range') {
      state[key] = Number(input.value);
    } else {
      state[key] = input.value;
    }
  });
  return state;
}

function updateSizingLabels(state) {
  const map = {
    contentWidth: 'val-contentWidth',
    sideWidth: 'val-sideWidth',
    spacing: 'val-spacing',
    fontScale: 'val-fontScale'
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${state[key]}%`;
  });
}

function syncLinearDarkRow(state) {
  const row = document.getElementById('linear-dark-row');
  if (!row) return;
  const on = !!(state?.linearView ?? document.getElementById('linear-view-toggle')?.checked);
  row.hidden = !on;
}

function applyControlsToUi(state) {
  checkboxes.forEach((cb) => {
    const key = cb.dataset.section;
    cb.checked = !!state[key];
  });
  sizingInputs.forEach((input) => {
    const key = input.dataset.sizing;
    if (state[key] === undefined) return;
    input.value = state[key];
  });
  updateSizingLabels(state);
  syncLinearDarkRow(state);
}

function saveAndPush() {
  const state = collectState();
  updateSizingLabels(state);
  syncLinearDarkRow(state);
  chrome.storage.sync.set({ jiraDeclutter: state });
  pushToActiveTab(state);
}

async function initConnectionStatus() {
  const tab = await getActiveTab();
  if (!tab) {
    setStatus('No active tab found.', 'warn');
    return;
  }
  if (!isJiraUrl(tab.url || '')) {
    setStatus('Open a Jira tab to use toggles.', 'warn');
    return;
  }

  const ready = await ensureContentScript(tab);
  if (!ready.ok) {
    setStatus('Refresh this Jira tab, then reopen the extension.', 'warn');
    return;
  }

  const href = tab.url || '';
  const onIssue = /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href) || /selectedIssue=/i.test(href);
  if (ready.injected) {
    setStatus('Connected (injected). Try the Layout toggles.', 'ok');
  } else if (!onIssue) {
    setStatus('On a board — open an issue for size & font.', 'info');
  } else {
    setStatus('Connected to issue page', 'ok');
  }
}

// Tabs
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const active = panel.id === `panel-${name}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  });
});

// Load saved state
chrome.storage.sync.get('jiraDeclutter', (result) => {
  const state = { ...DEFAULTS, ...(result.jiraDeclutter || {}) };
  applyControlsToUi(state);
});

checkboxes.forEach((cb) => {
  cb.addEventListener('change', saveAndPush);
});

sizingInputs.forEach((input) => {
  const eventName = input.type === 'range' ? 'input' : 'change';
  input.addEventListener(eventName, saveAndPush);
});

document.getElementById('reset-btn').addEventListener('click', () => {
  applyControlsToUi({ ...DEFAULTS });
  chrome.storage.sync.set({ jiraDeclutter: { ...DEFAULTS } });
  pushToActiveTab({ ...DEFAULTS });
});

initConnectionStatus();
