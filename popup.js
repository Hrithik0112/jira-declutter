const DEFAULTS = {
  sidebar: true,
  topnav: true,
  description: true,
  attachments: true,
  childissues: true,
  linkedissues: true,
  activity: true,
  details: true,
  people: true,
  dates: true,
  development: true,
  timetracking: true,
  sprint: true
};

const checkboxes = document.querySelectorAll('input[data-section]');
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
      host === 'login.jira.unifize.com' ||
      host.endsWith('.jira.unifize.com')
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

  // Content script missing (common after Load unpacked) — inject it now
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
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
  if (!onIssue) {
    setStatus('Layout toggles work here. Open an issue for the rest.', 'info');
  } else {
    setStatus('Connected to Jira', 'ok');
  }
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
    setStatus('On a board — Layout toggles work; open an issue for the rest.', 'info');
  } else {
    setStatus('Connected to issue page', 'ok');
  }
}

// Load saved state
chrome.storage.sync.get('jiraDeclutter', (result) => {
  const state = result.jiraDeclutter || { ...DEFAULTS };
  checkboxes.forEach((cb) => {
    const key = cb.dataset.section;
    cb.checked = state[key] !== false;
  });
});

// When a toggle changes, save + push to content script
checkboxes.forEach((cb) => {
  cb.addEventListener('change', () => {
    const state = {};
    checkboxes.forEach((c) => {
      state[c.dataset.section] = c.checked;
    });
    chrome.storage.sync.set({ jiraDeclutter: state });
    pushToActiveTab(state);
  });
});

// Reset button
document.getElementById('reset-btn').addEventListener('click', () => {
  checkboxes.forEach((cb) => { cb.checked = true; });
  chrome.storage.sync.set({ jiraDeclutter: { ...DEFAULTS } });
  pushToActiveTab({ ...DEFAULTS });
});

initConnectionStatus();
