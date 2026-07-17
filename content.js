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
  'details', 'development', 'morefields', 'automation',
  'people', 'dates', 'timetracking', 'sprint', 'timestamps'
];

const LAYOUT_TAG = {
  sidebar: 'jd-section-sidebar',
  topnav: 'jd-section-topnav',
  issuemodal: 'jd-section-issuemodal'
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

  // Fullscreen is opt-in (true = expand issue modal)
  if (state.fullscreen === true) {
    root.classList.add('jd-fullscreen-issue');
  } else {
    root.classList.remove('jd-fullscreen-issue');
  }

  applySizing(state);

  // Hide bordered shells left behind after section content is toggled off
  requestAnimationFrame(() => scrubEmptySideCards());
}

const FONT_FAMILIES = {
  default: '',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
};

function applySizing(state) {
  const root = document.documentElement;
  const contentWidth = Number(state.contentWidth ?? 100);
  const sideWidth = Number(state.sideWidth ?? 100);
  const spacing = Number(state.spacing ?? 100);
  const fontScale = Number(state.fontScale ?? 100);
  const fontFamily = state.fontFamily || 'default';

  root.style.setProperty('--jd-main-scale', String(contentWidth / 100));
  root.style.setProperty('--jd-side-scale', String(sideWidth / 100));
  root.style.setProperty('--jd-space-scale', String(spacing / 100));
  root.style.setProperty('--jd-font-scale', String(fontScale / 100));

  const family = FONT_FAMILIES[fontFamily] || '';
  if (family) {
    root.style.setProperty('--jd-font-family', family);
    root.classList.add('jd-custom-font');
  } else {
    root.style.removeProperty('--jd-font-family');
    root.classList.remove('jd-custom-font');
  }

  // Separate class so zoom only runs when font actually changes
  root.classList.toggle('jd-font-scaled', fontScale !== 100);

  const sizingOn =
    contentWidth !== 100 ||
    sideWidth !== 100 ||
    spacing !== 100 ||
    fontScale !== 100 ||
    fontFamily !== 'default';

  root.classList.toggle('jd-sizing', sizingOn);
  tagIssueRoot();
}

function tagIssueRoot() {
  const cls = 'jd-issue-root';
  clearTagged(cls);

  const candidates = [
    '[data-testid="issue.views.issue-details.issue-layout.issue-layout"]',
    '.jd-section-issuemodal',
    '[role="dialog"]:has([data-testid*="issue.views" i])',
    '[data-testid*="issue-view-modal" i]',
    '[data-testid="software-board.card-modal"]'
  ];

  for (const sel of candidates) {
    let el = null;
    try {
      el = document.querySelector(sel);
    } catch (_) {
      continue;
    }
    if (el) {
      el.classList.add(cls);
      return;
    }
  }
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
      '[data-vc="issue-view-context-items-details-panel-slot"]',
      '[data-vc="issue-view-context-group-details-group"]',
      '[data-testid="issue-view-layout-templates-views.ui.context.visible-hidden.ui.context-group.container.details-group"]',
      '[data-testid*="container.details-group"]',
      '[data-vc="details-group-header"]'
    ],
    development: [
      '[data-vc="issue-view-development-context-panel"]',
      '[data-testid="issue-view-layout-templates-views.ui.context.visible-hidden.ui.context-group.container.development-context-panel"]'
    ],
    morefields: [
      '[data-vc="issue-view-context-group-secondary-context-items"]',
      '[data-testid="issue-view-layout-templates-views.ui.context.visible-hidden.ui.context-group.container.secondary-context-items"]',
      '[data-testid*="container.secondary-context-items"]',
      '[data-vc="secondary-context-items-header"]'
    ],
    automation: [
      '[data-vc="issue-view-automation-apps-panel"]',
      '[data-testid="issue-view-layout-templates-views.ui.context.visible-hidden.ui.ecosystem-context-group.container.automation-issue-audit-log-panel"]',
      '[data-testid*="container.automation-issue-audit-log-panel"]',
      '[data-vc*="automation-issue-audit-log-panel"]'
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
    timetracking: [
      '[data-testid="issue.views.issue-base.foundation.time-tracking.section"]',
      '#timetrackingmodule'
    ],
    sprint: [
      '[data-testid="issue.views.issue-base.foundation.sprint.section"]',
      '#sprint-val'
    ],
    timestamps: [
      '[data-testid*="created-date" i]',
      '[data-testid*="updated-date" i]',
      '[data-testid*="issue.views.issue-base.foundation.dates" i]'
    ]
  };

  Object.entries(map).forEach(([section, selectors]) => {
    const cls = `jd-section-${section}`;
    // Clear stale tags so a wrong parent from a previous pass can't keep hiding everything
    clearTagged(cls);
    tagMatches(selectors, cls);
  });

  // Prefer outermost context-panel roots (stable data-vc from Jira issue layout)
  tagContextPanels({
    details: ['details-panel-slot', 'details-group', 'details-context-panel'],
    development: ['development-context-panel'],
    morefields: ['secondary-context-items'],
    automation: ['automation-apps-panel', 'automation-issue-audit-log-panel']
  });

  tagTimestamps();
}

/**
 * Tag only the outermost issue-view panel for each side section.
 * Development: data-vc="issue-view-development-context-panel"
 * Automation:  data-vc="issue-view-automation-apps-panel"
 */
function tagContextPanels(keyMap) {
  Object.entries(keyMap).forEach(([section, slugs]) => {
    const cls = `jd-section-${section}`;
    const slugList = Array.isArray(slugs) ? slugs : [slugs];

    slugList.forEach((slug) => {
      const selectors = [
        `[data-vc="issue-view-${slug}"]`,
        `[data-vc*="${slug}"]`,
        `[data-testid*="${slug}"]`
      ];

      selectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            // Prefer the known outermost roots when present
            const outer =
              el.closest(`[data-vc="issue-view-${slug}"]`) ||
              el.closest(`[data-vc="issue-view-automation-apps-panel"]`) ||
              el.closest(`[data-vc="issue-view-development-context-panel"]`) ||
              el.closest(`[data-vc="issue-view-context-items-details-panel-slot"]`) ||
              el.closest(`[data-vc="issue-view-context-group-details-group"]`) ||
              el.closest(`[data-vc="issue-view-context-group-secondary-context-items"]`) ||
              el.closest(`[data-testid*="container.secondary-context-items"]`) ||
              el.closest(`[data-testid*="container.details-group"]`) ||
              el.closest(`[data-testid*="container.${slug}"]`) ||
              el;

            // Don't tag a node that already sits inside a same-section outer card
            if (outer.parentElement && outer.parentElement.closest(`.${cls}`)) {
              return;
            }
            outer.classList.add(cls, 'jd-accordion-card');
          });
        } catch (_) {
          /* ignore */
        }
      });
    });
  });
}

/**
 * After hides apply, remove leftover empty bordered shells
 * only for cards we explicitly tagged as accordion items.
 */
function scrubEmptySideCards() {
  document.querySelectorAll('.jd-empty-shell').forEach((el) => {
    el.classList.remove('jd-empty-shell');
  });

  const root = document.documentElement;
  const hideMap = [
    ['jd-hide-details', 'jd-section-details'],
    ['jd-hide-development', 'jd-section-development'],
    ['jd-hide-morefields', 'jd-section-morefields'],
    ['jd-hide-automation', 'jd-section-automation']
  ];

  hideMap.forEach(([hideCls, sectionCls]) => {
    if (!root.classList.contains(hideCls)) return;

    document.querySelectorAll('.' + sectionCls + '.jd-accordion-card').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const rect = el.getBoundingClientRect();
      if (text === '' && rect.height > 0 && rect.height < 160) {
        el.classList.add('jd-empty-shell');
      }
    });
  });
}

function tagTimestamps() {
  const cls = 'jd-section-timestamps';
  document.querySelectorAll('span, div, p, dd, time').forEach((el) => {
    if (el.children.length > 3) return;
    const text = (el.textContent || '').trim();
    if (/^Created\b/i.test(text) || /^Updated\b/i.test(text)) {
      // Tag a small wrapper, not a huge ancestor
      let node = el;
      for (let i = 0; i < 3 && node; i++) {
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 80 && rect.width < 480) {
          node.classList.add(cls);
        }
        node = node.parentElement;
      }
    }
  });
}

function tagIssueModal() {
  const cls = LAYOUT_TAG.issuemodal;
  const wrapCls = cls + '-wrap';
  clearTagged(cls);
  clearTagged(wrapCls);
  clearTagged('jd-section-issuemodal-scroll');

  const issueContentSel = [
    '[data-testid="issue.views.issue-details.issue-layout.issue-layout"]',
    '[data-testid="issue.views.issue-details.issue-layout.container-left"]',
    '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
    '[data-testid*="issue.views.issue-details" i]',
    '[data-testid="issue-view"]',
    '#jira-issue-header'
  ].join(',');

  const shells = new Set();

  function tagShell(shell) {
    if (!shell || shells.has(shell)) return;
    shells.add(shell);
    shell.classList.add(cls);

    // Loosen the immediate parent; hide overflow on scroll portals (the white blank scroller)
    let node = shell.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      if (i === 0) node.classList.add(wrapCls);
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX)) {
        node.classList.add('jd-section-issuemodal-scroll');
      }
      node = node.parentElement;
    }
  }

  // Prefer the outermost dialog / modal shell that contains an issue
  document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
    if (!dialog.querySelector(issueContentSel)) return;
    tagShell(dialog);
  });

  document.querySelectorAll(
    '[data-testid="software-board.card-modal"], [data-testid*="issue-view-modal" i], [data-testid*="IssueViewModal" i]'
  ).forEach((el) => tagShell(el));

  // Fallback: issue layout inside a modal, but only if no dialog was tagged
  if (shells.size === 0) {
    document.querySelectorAll(
      '[data-testid="issue.views.issue-details.issue-layout.issue-layout"]'
    ).forEach((el) => {
      const overlay = el.closest(
        '[role="dialog"], [data-testid*="modal" i], [data-testid*="Modal" i], [data-testid="software-board.card-modal"]'
      );
      if (overlay) tagShell(overlay);
    });
  }
}

function retagDom() {
  tagSidebar();
  tagTopNav();
  tagIssueModal();
  tagIssueSections();
  tagIssueRoot();
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
