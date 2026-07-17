/**
 * Jira Declutter — Content Script
 *
 * Adds/removes `jd-hide-{section}` classes on <html> based on saved prefs.
 * Also tags live DOM nodes with `jd-section-*` classes so CSS can hide
 * elements even when Atlassian changes data-testid attributes.
 */

if (window.__jiraDeclutterLoaded) {
  // Already injected (e.g. popup re-injected after Load unpacked)
} else {
window.__jiraDeclutterLoaded = true;

const SECTIONS = [
  'sidebar', 'topnav',
  'description', 'attachments', 'childissues', 'linkedissues', 'activity',
  'details', 'people', 'dates', 'development', 'timetracking', 'sprint'
];

const LAYOUT_TAG = {
  sidebar: 'jd-section-sidebar',
  topnav: 'jd-section-topnav'
};

function applyState(state) {
  const root = document.documentElement;
  SECTIONS.forEach((section) => {
    const cls = `jd-hide-${section}`;
    if (state[section] === false) {
      root.classList.add(cls);
    } else {
      root.classList.remove(cls);
    }
  });
}

function clearTagged(cls) {
  document.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
}

function tagMatches(selectors, cls) {
  selectors.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach((el) => el.classList.add(cls));
    } catch (_) {
      /* ignore invalid selectors */
    }
  });
}

/**
 * Find the new (2025+) Atlassian sidebar by walking up from known
 * sidebar controls / landmark labels, then fall back to CSS selectors.
 */
function tagSidebar() {
  const cls = LAYOUT_TAG.sidebar;
  clearTagged(cls);

  const control = document.querySelector([
    '[aria-label*="Hide sidebar" i]',
    '[aria-label*="Collapse sidebar" i]',
    '[aria-label*="Expand sidebar" i]',
    '[aria-label*="Show sidebar" i]',
    'button[aria-controls*="side" i]',
    'button[aria-controls*="nav" i]'
  ].join(','));

  if (control) {
    let node = control;
    for (let i = 0; i < 12 && node; i++) {
      const role = (node.getAttribute('role') || '').toLowerCase();
      const label = (node.getAttribute('aria-label') || '').toLowerCase();
      const testId = (node.getAttribute('data-testid') || '').toLowerCase();
      const tag = node.tagName;
      if (
        tag === 'NAV' ||
        tag === 'ASIDE' ||
        role === 'navigation' ||
        role === 'complementary' ||
        label.includes('sidebar') ||
        label.includes('side navigation') ||
        testId.includes('side') ||
        testId.includes('nav-menu') ||
        testId.includes('navigation')
      ) {
        node.classList.add(cls);
        break;
      }
      node = node.parentElement;
    }
  }

  // Landmark / testid fallbacks (old + new Jira)
  tagMatches([
    '[data-testid="ContextualNavigation"]',
    '[data-testid="ak-side-navigation"]',
    '[data-testid="project-level-sidebar"]',
    '[data-testid="side-navigation"]',
    '[data-testid="nav-menu"]',
    '[data-testid="page-layout.slot.left-sidebar"]',
    '[data-testid="page-layout.slot.navigation"]',
    '[data-testid*="side-navigation" i]',
    '[data-testid*="SideNavigation" i]',
    'nav[aria-label="Space navigation"]',
    'nav[aria-label="Sidebar"]',
    'nav[aria-label="Side navigation"]',
    'nav[aria-label*="sidebar" i]',
    'aside[aria-label*="navigation" i]',
    'aside[aria-label*="sidebar" i]',
    '[role="navigation"][aria-label*="sidebar" i]',
    '[role="complementary"][class*="sidebar" i]'
  ], cls);

  // Structural heuristic: left-edge nav containing "Spaces" / "For you"
  if (!document.querySelector('.' + cls)) {
    document.querySelectorAll('nav, aside, [role="navigation"], [role="complementary"]').forEach((el) => {
      const text = (el.innerText || '').slice(0, 800);
      if (/(For you|Spaces|Starred)/.test(text) && /(Filters|Dashboards|Apps|Backlog|Boards)/.test(text)) {
        const rect = el.getBoundingClientRect();
        if (rect.left < 80 && rect.width > 120 && rect.width < 480 && rect.height > 200) {
          el.classList.add(cls);
        }
      }
    });
  }
}

function tagTopNav() {
  const cls = LAYOUT_TAG.topnav;
  clearTagged(cls);

  tagMatches([
    '[data-testid="atlassian-navigation"]',
    '[data-testid="navigation-header"]',
    '[data-testid="top-navigation"]',
    '[data-testid="page-layout.slot.top-navigation"]',
    '[data-testid="page-layout.slot.banner"]',
    '[data-testid*="top-navigation" i]',
    '[data-testid*="TopNavigation" i]',
    'nav[aria-label="Primary"]',
    'nav[aria-label*="top" i]',
    'header[role="banner"]',
    '[role="banner"]'
  ], cls);

  // Prefer the top utility bar (search / create / profile), not page headings
  if (!document.querySelector('.' + cls)) {
    document.querySelectorAll('header, [role="banner"], nav').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top > 80 || rect.height < 36 || rect.height > 90 || rect.width < window.innerWidth * 0.5) {
        return;
      }
      const text = (el.innerText || '').slice(0, 400);
      const hasSearch = !!el.querySelector('input[placeholder*="Search" i], [aria-label*="Search" i], [data-testid*="search" i]');
      const hasCreate = /Create/.test(text) || !!el.querySelector('[aria-label*="Create" i]');
      if (hasSearch || hasCreate) {
        el.classList.add(cls);
      }
    });
  }
}

function tagIssueSections() {
  const map = {
    description: [
      '[data-testid="issue.views.field.rich-text.description"]',
      '[data-testid="issue-field-description"]',
      '#description-val',
      '[data-testid*="description" i]'
    ],
    attachments: [
      '[data-testid="issue.views.issue-base.foundation.attachment-panel"]',
      '[data-testid="issue.views.issue-base.content.attachment.container"]',
      '#attachment_thumbnails',
      '#attachmentmodule',
      '[data-testid*="attachment" i]'
    ],
    childissues: [
      '[data-testid="issue.views.issue-base.foundation.child-issues-panel"]',
      '[data-testid="issue.views.common.child-issues-panel.issues-container"]',
      '#view-subtasks',
      '[data-testid*="child-issue" i]',
      '[data-testid*="subtask" i]'
    ],
    linkedissues: [
      '[data-testid="issue.views.issue-base.foundation.link-panel"]',
      '[data-testid="issue.views.issue-base.content.issue-links.group-container"]',
      '#linkingmodule',
      '[data-testid*="issue-link" i]',
      '[data-testid*="link-panel" i]'
    ],
    activity: [
      '[data-testid="issue.views.issue-base.foundation.activity-panel"]',
      '[data-testid="issue-activity-feed"]',
      '[data-testid="issue.activity"]',
      '#activity-panel',
      '#activitymodule',
      '[data-testid*="activity" i]',
      '[data-testid*="comment" i]'
    ],
    details: [
      '[data-testid="issue.views.issue-base.foundation.details.section"]',
      '[data-testid="issue-view-foundation-details-section"]',
      '#details-module'
    ],
    people: [
      '[data-testid="issue.views.issue-base.foundation.people.section"]',
      '[data-testid="issue-view-foundation-people-section"]',
      '#peoplemodule'
    ],
    dates: [
      '[data-testid="issue.views.issue-base.foundation.dates.section"]',
      '[data-testid="issue-view-foundation-dates-section"]',
      '#datesmodule'
    ],
    development: [
      '[data-testid="issue.views.issue-base.foundation.development.section"]',
      '[data-testid="issue-view-foundation-development-section"]',
      '#devstatus-container'
    ],
    timetracking: [
      '[data-testid="issue.views.issue-base.foundation.time-tracking.section"]',
      '#timetrackingmodule'
    ],
    sprint: [
      '[data-testid="issue.views.issue-base.foundation.sprint.section"]',
      '#sprint-val'
    ]
  };

  Object.entries(map).forEach(([section, selectors]) => {
    const cls = `jd-section-${section}`;
    // Keep existing tags; re-apply matches (idempotent)
    tagMatches(selectors, cls);
  });
}

function retagDom() {
  tagSidebar();
  tagTopNav();
  tagIssueSections();
}

function loadAndApply() {
  chrome.storage.sync.get('jiraDeclutter', (result) => {
    retagDom();
    if (result.jiraDeclutter) {
      applyState(result.jiraDeclutter);
    }
  });
}

// Initial apply
loadAndApply();

// Live updates from popup (message)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'JIRA_DECLUTTER_PING') {
    sendResponse({ ok: true, href: location.href });
    return true;
  }
  if (msg.type === 'JIRA_DECLUTTER_UPDATE') {
    retagDom();
    applyState(msg.state || {});
    sendResponse({ ok: true });
    return true;
  }
});

// Also react to storage writes (works even if sendMessage fails)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.jiraDeclutter) {
    retagDom();
    applyState(changes.jiraDeclutter.newValue || {});
  }
});

// Re-tag after SPA navigations / late-mounted panels
let lastUrl = location.href;
let retagTimer = null;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    loadAndApply();
    return;
  }
  // Debounce re-tagging as Jira mounts panels
  clearTimeout(retagTimer);
  retagTimer = setTimeout(() => {
    retagDom();
    chrome.storage.sync.get('jiraDeclutter', (result) => {
      if (result.jiraDeclutter) applyState(result.jiraDeclutter);
    });
  }, 400);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

} // end __jiraDeclutterLoaded guard
