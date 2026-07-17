/**
 * Jira Declutter — Linear View
 *
 * Scrapes the open issue from Jira's DOM and renders a minimal Linear-style overlay.
 * Only surfaces fields that actually exist on the issue.
 */

(function () {
  if (window.__jdLinearViewLoaded) return;
  window.__jdLinearViewLoaded = true;

  const ROOT_ID = 'jd-linear-root';
  const HOST_CLASS = 'jd-linear-view';

  let enabled = false;
  let darkMode = false;
  let refreshTimer = null;
  let lastFingerprint = '';
  let bootTimer = null;

  const AVATAR_COLORS = [
    '#5e6ad2', '#26b5ce', '#4cb782', '#f2c94c', '#eb5757',
    '#bb87fc', '#f2994a', '#56ccf2'
  ];

  const EMPTY_VALUE = /^(none|n\/a|—|-|add text|add|unassigned|select\.\.\.|)$/i;

  function $(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (_) {
      return null;
    }
  }

  function $$(sel, root) {
    try {
      return Array.from((root || document).querySelectorAll(sel));
    } catch (_) {
      return [];
    }
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorFor(name) {
    let hash = 0;
    const s = String(name || 'x');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function isIssueOpen() {
    const href = location.href;
    return /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href) || /selectedIssue=/i.test(href);
  }

  function issueKeyFromUrl() {
    const browse = location.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
    if (browse) return browse[1].toUpperCase();
    const selected = location.search.match(/[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/i);
    if (selected) return selected[1].toUpperCase();
    return '';
  }

  function findIssueRoot() {
    return (
      $('[data-testid="issue.views.issue-details.issue-layout.issue-layout"]') ||
      $('.jd-issue-root') ||
      $('.jd-section-issuemodal') ||
      $('[role="dialog"]:has([data-testid*="issue.views" i])') ||
      $('[data-testid*="issue-view-modal" i]') ||
      document.body
    );
  }

  function leftCol(root) {
    return (
      $('[data-testid="issue.views.issue-details.issue-layout.container-left"]', root) ||
      root
    );
  }

  function rightCol(root) {
    return (
      $('[data-testid="issue.views.issue-details.issue-layout.container-right"]', root) ||
      root
    );
  }

  /** Jira lazy-loads comment bodies until scrolled into view. */
  function wakeComments(root) {
    const list = $('[data-testid="issue.activity.comments-list"]', root);
    if (list) list.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $$('[data-testid^="comment-base-item-"]', root).slice(0, 12).forEach((item) => {
      try {
        item.scrollIntoView({ block: 'nearest' });
      } catch (_) {
        /* ignore */
      }
    });
  }

  function scrapeKey(root) {
    const fromUrl = issueKeyFromUrl();
    if (fromUrl) return fromUrl;

    const crumb = $(
      '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
      root
    );
    const t = textOf(crumb);
    const m = t.match(/([A-Z][A-Z0-9]+-\d+)/i);
    if (m) return m[1].toUpperCase();

    const link = $$('a[href*="/browse/"]', root).find((a) =>
      /\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(a.getAttribute('href') || '')
    );
    const hm = (link?.getAttribute('href') || '').match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
    return hm ? hm[1].toUpperCase() : '';
  }

  function scrapeProject(root, key) {
    const crumbs = $$(
      '[data-testid*="breadcrumb" i] a, nav[aria-label*="Breadcrumb" i] a',
      root
    )
      .map(textOf)
      .filter(Boolean);

    for (const c of crumbs) {
      if (/^[A-Z][A-Z0-9]+-\d+$/i.test(c)) continue;
      if (/^(spaces?|back|issues?|board|backlog)$/i.test(c)) continue;
      if (c.length > 1 && c.length < 48) return c;
    }

    // Board context: project name in sidebar current space
    const space = $('a[aria-current="page"]', document.body);
    const spaceText = textOf(space);
    if (spaceText && spaceText.length < 48 && !/board|sprint/i.test(spaceText)) {
      return spaceText;
    }

    if (key && key.includes('-')) return key.split('-')[0];
    return '';
  }

  function scrapeIssueType(root) {
    const btn = $(
      '[data-testid="issue-view-foundation.noneditable-issue-type.button"], [data-testid*="issue-type" i]',
      root
    );
    const aria = btn?.getAttribute('aria-label') || '';
    const img = $('img[alt]', btn) || $(
      'img[alt="Defect"], img[alt="Bug"], img[alt="Story"], img[alt="Task"], img[alt="Epic"]',
      root
    );
    const name = aria || img?.getAttribute('alt') || '';
    if (!name) return null;
    return {
      name,
      icon: img?.src || ''
    };
  }

  function scrapeTitle(root) {
    const el =
      $('[data-testid="issue.views.issue-base.foundation.summary.heading"]', root) ||
      $('[data-testid*="summary.heading" i]', root) ||
      $('h1', leftCol(root));
    return textOf(el) || 'Untitled issue';
  }

  function scrapeDescriptionHtml(root) {
    const el =
      $('[data-testid="issue.views.field.rich-text.description"]', root) ||
      $('[data-testid="issue-field-description"]', root);
    if (!el) return '';

    const renderer =
      el.querySelector('.ak-renderer-document, [data-testid*="renderer" i]') || el;
    const clone = renderer.cloneNode(true);
    clone.querySelectorAll('button, [role="button"], script, style').forEach((n) => n.remove());
    // Drop broken media chrome; keep img if it has a usable src
    clone.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) img.remove();
    });
    const html = clone.innerHTML.trim();
    const plain = textOf(clone);
    if (!plain || /^add a description/i.test(plain)) return '';
    return html;
  }

  function scrapePerson(root, role) {
    // role: assignee | reporter
    const wrap =
      $(`[data-testid="issue.views.field.user.${role}"]`, root) ||
      $(`[data-testid="issue.issue-view-layout.issue-view-${role}-field.${role}"]`, root) ||
      $(`[data-testid*="${role}" i]`, rightCol(root));

    if (!wrap) return null;

    const img = wrap.querySelector('img');
    let name =
      img?.getAttribute('alt') ||
      textOf(wrap)
        .replace(new RegExp('^' + role, 'i'), '')
        .replace(/Assign to me/i, '')
        .replace(/Pin to top.*/i, '')
        .trim();

    // Prefer aria on edit control
    const edit = wrap.querySelector(`[aria-label*="${role}" i], [aria-label*="edit" i]`);
    const aria = edit?.getAttribute('aria-label') || '';
    const ariaName = aria.replace(/-?\s*edit\s+.*/i, '').trim();
    if (ariaName && ariaName.length < 80) name = ariaName;

    name = name.replace(/\s*avatar$/i, '').trim();
    if (!name || EMPTY_VALUE.test(name)) return null;

    return {
      name,
      initials: initials(name),
      color: colorFor(name),
      src: img?.src || ''
    };
  }

  function scrapeStatus(root) {
    const el =
      $('[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"]', root) ||
      $('[data-testid="issue-field-status.ui.status-view.status-button.status-button"]', root) ||
      $('[data-testid*="status-field" i]', root);

    let text = textOf(el).replace(/^status\s*/i, '');
    const aria = el?.getAttribute('aria-label') || '';
    const ariaStatus = aria.replace(/\s*-\s*Change status.*/i, '').trim();
    if (ariaStatus) text = ariaStatus;
    text = text || 'Todo';

    const lower = text.toLowerCase();
    let tone = 'default';
    if (/done|closed|resolved|complete|gtg|shipped/.test(lower)) tone = 'done';
    else if (/progress|review|develop|doing|qa|pending|signoff|sign-off/.test(lower)) {
      tone = 'progress';
    } else if (/block|hold|impediment/.test(lower)) tone = 'blocked';
    else if (/todo|to\s*do|open|backlog|ready/.test(lower)) tone = 'todo';

    return { text, tone };
  }

  function scrapeFieldByHeading(scope, labels) {
    const want = labels.map((l) => l.toLowerCase());
    const headings = $$(
      '[data-testid^="issue-field-heading-styled-field-heading"], h2, h3, label',
      scope
    );

    for (const heading of headings) {
      const label = textOf(heading).replace(/:$/, '');
      if (!want.includes(label.toLowerCase())) continue;

      const wrap =
        heading.closest(
          '[data-testid*="issue.issue-view-layout" i], [data-testid*="issue.views.field" i]'
        ) || heading.parentElement;

      let val = textOf(wrap)
        .replace(label, '')
        .replace(/Assign to me/i, '')
        .replace(/Pin to top.*/i, '')
        .replace(/Add text/i, '')
        .trim();

      if (EMPTY_VALUE.test(val)) val = '';
      return { label, value: val, el: wrap };
    }
    return null;
  }

  function scrapeCustomDetails(root) {
    const left = leftCol(root);
    const rows = [];
    const headings = $$(
      '[data-testid^="issue-field-heading-styled-field-heading"]',
      left
    );

    for (const heading of headings) {
      const label = textOf(heading);
      if (!label || /description/i.test(label)) continue;

      const wrap =
        heading.closest(
          '[data-testid*="issue.issue-view-layout" i], [data-testid*="issue.views.field" i]'
        ) || heading.parentElement;

      let value = textOf(wrap)
        .replace(label, '')
        .replace(/Add text/gi, '')
        .trim();

      if (EMPTY_VALUE.test(value)) continue;
      rows.push({ label, value });
    }

    return rows;
  }

  function scrapeSideMeta(root) {
    const right = rightCol(root);

    const priorityRaw = scrapeFieldByHeading(right, ['Priority'])?.value || '';
    const priority = priorityRaw ? { text: priorityRaw } : null;

    const labelsFound = scrapeFieldByHeading(right, ['Labels', 'Label']);
    const labels = [];
    if (labelsFound?.el) {
      const seen = new Set();
      for (const t of $$('a, span, button', labelsFound.el).map(textOf)) {
        if (!t || t.length >= 32 || /^(labels?|none|add)$/i.test(t)) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        labels.push(t);
        if (labels.length >= 8) break;
      }
    }

    let estimate = scrapeFieldByHeading(right, [
      'Story Points',
      'Story point estimate',
      'Estimate',
      'Original estimate'
    ])?.value || '';
    if (/^\d+(\.\d+)?$/.test(estimate)) estimate += ' pts';

    return {
      priority,
      labels,
      sprint: scrapeFieldByHeading(right, ['Sprint', 'Cycle', 'Iteration'])?.value || '',
      estimate,
      dueDate: scrapeFieldByHeading(right, ['Due date', 'Due', 'Target date'])?.value || ''
    };
  }

  function scrapeTimestamps(root) {
    const raw = textOf($('[data-vc="issue-view-meta-timestamps"]', root));
    const created = (raw.match(/Created\s+(.+?)(?:\s+Updated|$)/i) || [])[1]?.trim() || '';
    const updated = (raw.match(/Updated\s+(.+)$/i) || [])[1]?.trim() || '';
    return { created, updated };
  }

  function scrapeAttachments(root) {
    const t = textOf(
      $('[data-testid="issue.views.issue-base.content.attachment.heading.section-heading-title"]', root)
    );
    const n = Number((t.match(/(\d+)/) || [])[1] || 0);
    return n > 0 ? n : 0;
  }

  function scrapeWatchers(root) {
    const n = parseInt(
      textOf(
        $(
          '[data-testid="issue.watchers.action-button.counter"], [data-testid="issue.watchers.action-button.root"]',
          root
        )
      ),
      10
    );
    return Number.isFinite(n) ? n : 0;
  }

  function scrapeChildIssues(root, parentKey) {
    const panel = $(
      '[data-testid*="child-issues" i], [data-testid*="subtask" i], #view-subtasks',
      root
    );
    if (!panel) return [];

    const rows = [];
    for (const link of $$('a[href*="/browse/"]', panel)) {
      const href = link.getAttribute('href') || '';
      const km = href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
      if (!km) continue;
      const key = km[1].toUpperCase();
      if (parentKey && key === parentKey.toUpperCase()) continue;

      const row =
        link.closest(
          '[data-testid*="child" i], [data-testid*="subtask" i], tr, li, [role="row"]'
        ) || link.parentElement;
      if (!row) continue;

      let title = textOf(link);
      if (title === key || !title) {
        title = textOf(row).replace(key, '').replace(/\s+/g, ' ').trim();
      }
      title = title.replace(/^(to do|todo|in progress|done|blocked)\s+/i, '').trim();
      if (!title || rows.some((r) => r.key === key)) continue;

      let tone = 'todo';
      const lower = textOf(row).toLowerCase();
      if (/done|closed|resolved|complete/.test(lower)) tone = 'done';
      else if (/progress|review|doing/.test(lower)) tone = 'progress';

      rows.push({ key, title: title.slice(0, 120), href: link.href, tone });
      if (rows.length >= 12) break;
    }
    return rows;
  }

  function scrapeComments(root) {
    wakeComments(root);
    const out = [];

    for (const item of $$(
      '[data-testid="issue.activity.comments-list"] [data-testid^="comment-base-item-"]',
      root
    )) {
      const header =
        item.querySelector('[data-testid$="-header"]') ||
        item.querySelector('[data-testid="comment.ui.header.avatar"]')?.parentElement;
      const body = item.querySelector('[data-testid$="-body"]');
      const timeEl = item.querySelector(
        '[data-testid="issue-timestamp.relative-time"], time'
      );
      const time = textOf(timeEl);
      const img = header?.querySelector('img');

      let authorName = (img?.alt || '').trim();
      if (!authorName) {
        authorName = textOf(header)
          .replace(time, '')
          .replace(/\(edited\)/i, '')
          .replace(/\s+\d+\s+(minutes?|hours?|days?|weeks?|months?)\s+ago.*$/i, '')
          .replace(/\s+last\s+\w+.*$/i, '')
          .replace(/\s+\d{1,2}\s+\w+\s+\d{4}.*$/i, '')
          .trim() || 'Someone';
      }

      let bodyHtml = '';
      if (body) {
        const clone = (body.querySelector('.ak-renderer-document') || body).cloneNode(true);
        clone.querySelectorAll('button, [role="button"], script, style').forEach((n) => n.remove());
        bodyHtml = clone.innerHTML.trim();
      }
      if (!textOf({ textContent: bodyHtml.replace(/<[^>]+>/g, ' ') })) continue;

      out.push({
        author: {
          name: authorName,
          initials: initials(authorName),
          color: colorFor(authorName),
          src: img?.src || ''
        },
        time,
        bodyHtml
      });
      if (out.length >= 10) break;
    }

    return out;
  }

  function scrapeBranches(root) {
    const panel = $(
      '[data-vc="issue-view-development-context-panel"], [data-testid*="development" i]',
      root
    );
    if (!panel) return [];
    if (!textOf(panel).replace(/^Development/i, '').trim()) return [];

    return $$('a', panel)
      .map((a) => ({ text: textOf(a), href: a.href }))
      .filter((l) => l.text && l.text.length < 80)
      .filter((l) => /branch|feat\/|fix\/|bitbucket|github|gitlab/i.test(l.text + l.href))
      .slice(0, 4);
  }

  function scrapeIssue() {
    if (!isIssueOpen()) return null;
    const root = findIssueRoot();
    wakeComments(root);

    const key = scrapeKey(root);
    const children = scrapeChildIssues(root, key);
    const details = scrapeCustomDetails(root);
    const severityRow = details.find((d) => /severity/i.test(d.label));
    const severity =
      severityRow ||
      (() => {
        const f = scrapeFieldByHeading(root, ['Severity']);
        return f?.value ? { label: 'Severity', value: f.value } : null;
      })();
    const side = scrapeSideMeta(root);
    const stamps = scrapeTimestamps(root);

    return {
      key,
      project: scrapeProject(root, key),
      issueType: scrapeIssueType(root),
      title: scrapeTitle(root),
      descriptionHtml: scrapeDescriptionHtml(root),
      status: scrapeStatus(root),
      priority: side.priority,
      assignee: scrapePerson(root, 'assignee'),
      reporter: scrapePerson(root, 'reporter'),
      severity: severity || null,
      labels: side.labels,
      sprint: side.sprint,
      estimate: side.estimate,
      dueDate: side.dueDate,
      details: details.filter((d) => !/severity/i.test(d.label)),
      children,
      progress: children.length
        ? {
            done: children.filter((c) => c.tone === 'done').length,
            total: children.length
          }
        : null,
      comments: scrapeComments(root),
      branches: scrapeBranches(root),
      attachments: scrapeAttachments(root),
      watchers: scrapeWatchers(root),
      created: stamps.created,
      updated: stamps.updated
    };
  }

  function fingerprint(data) {
    if (!data) return '';
    return [
      data.key,
      data.title,
      data.status?.text,
      data.assignee?.name,
      data.reporter?.name,
      data.severity?.value,
      data.attachments,
      data.comments?.length,
      data.comments?.map((c) => c.author.name + c.time).join('|'),
      data.details?.map((d) => d.label + d.value).join('|'),
      (data.descriptionHtml || '').length,
      data.created,
      data.updated
    ].join('::');
  }

  function avatarHtml(person, size) {
    if (!person) {
      return `<span class="jdl-avatar jdl-avatar--empty" style="width:${size}px;height:${size}px">—</span>`;
    }
    if (person.src) {
      return `<img class="jdl-avatar" src="${esc(person.src)}" alt="${esc(person.name)}" title="${esc(person.name)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" />`;
    }
    return `<span class="jdl-avatar jdl-avatar--initials" title="${esc(person.name)}" style="width:${size}px;height:${size}px;background:${esc(person.color)}">${esc(person.initials)}</span>`;
  }

  function field(label, innerHtml) {
    if (!innerHtml) return '';
    return `
      <div class="jdl-field">
        <span class="jdl-field-label">${esc(label)}</span>
        <div class="jdl-field-value">${innerHtml}</div>
      </div>`;
  }

  function renderEmpty() {
    return `
      <div class="jdl-shell jdl-shell--empty">
        <div class="jdl-empty">
          <p class="jdl-empty-title">No issue open</p>
          <p class="jdl-empty-copy">Open a Jira issue to see the Linear-style view.</p>
        </div>
        <button type="button" class="jdl-icon-btn jdl-close" aria-label="Close" data-jdl-close>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>`;
  }

  function render(data) {
    if (!data) return renderEmpty();
    const dark = darkMode;

    const typeIcon = data.issueType?.icon
      ? `<img class="jdl-type-icon" src="${esc(data.issueType.icon)}" alt="${esc(data.issueType.name || '')}" />`
      : '';

    const detailsHtml = data.details.length
      ? `
        <section class="jdl-section">
          <div class="jdl-section-head"><h2>Details</h2></div>
          <dl class="jdl-kv">
            ${data.details
              .map(
                (d) => `
              <div class="jdl-kv-row">
                <dt>${esc(d.label)}</dt>
                <dd>${esc(d.value)}</dd>
              </div>`
              )
              .join('')}
          </dl>
        </section>`
      : '';

    const childrenHtml = data.children.length
      ? `
        <section class="jdl-section">
          <div class="jdl-section-head">
            <h2>Sub-issues</h2>
            <span class="jdl-count">${data.children.length}</span>
          </div>
          <ul class="jdl-subissues">
            ${data.children
              .map(
                (c) => `
              <li>
                <a class="jdl-subissue" href="${esc(c.href)}">
                  <span class="jdl-status-dot jdl-status-dot--${esc(c.tone)}"></span>
                  <span class="jdl-subissue-key">${esc(c.key)}</span>
                  <span class="jdl-subissue-title">${esc(c.title)}</span>
                </a>
              </li>`
              )
              .join('')}
          </ul>
        </section>`
      : '';

    const attachHtml =
      data.attachments > 0
        ? `<p class="jdl-meta-line">${data.attachments} attachment${data.attachments === 1 ? '' : 's'}</p>`
        : '';

    const activityHtml = `
      <section class="jdl-section jdl-activity">
        <div class="jdl-section-head"><h2>Activity</h2></div>
        ${
          data.comments.length
            ? `<ul class="jdl-comments">
                ${data.comments
                  .map(
                    (c) => `
                  <li class="jdl-comment">
                    ${avatarHtml(c.author, 28)}
                    <div class="jdl-comment-body">
                      <div class="jdl-comment-meta">
                        <span class="jdl-comment-author">${esc(c.author.name)}</span>
                        ${c.time ? `<span class="jdl-comment-time">${esc(c.time)}</span>` : ''}
                      </div>
                      <div class="jdl-prose jdl-prose--sm">${c.bodyHtml}</div>
                    </div>
                  </li>`
                  )
                  .join('')}
              </ul>`
            : `<p class="jdl-muted">No comments loaded yet.</p>`
        }
      </section>`;

    const labelsHtml = data.labels.length
      ? `<div class="jdl-chips">${data.labels
          .map((l) => `<span class="jdl-chip">${esc(l)}</span>`)
          .join('')}</div>`
      : '';

    const side = [
      field(
        'Status',
        `<span class="jdl-status-pill jdl-status-pill--${esc(data.status.tone)}">
          <span class="jdl-status-dot" aria-hidden="true"></span>
          ${esc(data.status.text)}
        </span>`
      ),
      data.issueType
        ? field(
            'Type',
            `<span class="jdl-inline-icon">${typeIcon}<span>${esc(data.issueType.name)}</span></span>`
          )
        : '',
      data.severity
        ? field('Severity', `<span class="jdl-severity">${esc(data.severity.value)}</span>`)
        : '',
      data.priority
        ? field('Priority', esc(data.priority.text))
        : '',
      field(
        'Assignee',
        data.assignee
          ? `<span class="jdl-assignee">${avatarHtml(data.assignee, 22)}<span>${esc(data.assignee.name)}</span></span>`
          : `<span class="jdl-muted">Unassigned</span>`
      ),
      data.reporter
        ? field(
            'Reporter',
            `<span class="jdl-assignee">${avatarHtml(data.reporter, 22)}<span>${esc(data.reporter.name)}</span></span>`
          )
        : '',
      labelsHtml ? field('Labels', labelsHtml) : '',
      data.sprint ? field('Cycle', esc(data.sprint)) : '',
      data.estimate ? field('Estimate', esc(data.estimate)) : '',
      data.dueDate ? field('Due date', esc(data.dueDate)) : '',
      data.progress
        ? field(
            'Progress',
            `<span>${data.progress.done} of ${data.progress.total} done</span>
             <div class="jdl-progress"><span style="width:${Math.round((data.progress.done / data.progress.total) * 100)}%"></span></div>`
          )
        : '',
      data.branches.length
        ? field(
            'Branches',
            `<div class="jdl-branches">${data.branches
              .map(
                (b) =>
                  `<a href="${esc(b.href)}" target="_blank" rel="noopener noreferrer">${esc(b.text)}</a>`
              )
              .join('')}</div>`
          )
        : '',
      data.created ? field('Created', esc(data.created)) : '',
      data.updated ? field('Updated', esc(data.updated)) : '',
      data.watchers > 0 ? field('Watchers', String(data.watchers)) : ''
    ].join('');

    const crumbProject = data.project || (data.key ? data.key.split('-')[0] : 'Issue');

    return `
      <div class="jdl-shell">
        <header class="jdl-topbar">
          <div class="jdl-crumb">
            <button type="button" class="jdl-back" data-jdl-close aria-label="Close Linear view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.5 2.5L4 7l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            ${typeIcon}
            <span class="jdl-crumb-project">${esc(crumbProject)}</span>
            <span class="jdl-crumb-sep">/</span>
            <span class="jdl-crumb-key">${esc(data.key || '—')}</span>
          </div>
          <div class="jdl-top-actions">
            <button type="button" class="jdl-icon-btn jdl-theme" aria-label="Toggle dark mode" data-jdl-theme title="Toggle dark mode">
              ${dark
                ? `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.25" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
                : `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.2 9.4A5.5 5.5 0 0 1 6.6 2.8 5.6 5.6 0 1 0 13.2 9.4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`}
            </button>
            <button type="button" class="jdl-icon-btn jdl-close" aria-label="Close Linear view" data-jdl-close>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        </header>

        <div class="jdl-layout">
          <main class="jdl-main">
            <h1 class="jdl-title">${esc(data.title)}</h1>
            <div class="jdl-prose">
              ${data.descriptionHtml || '<p class="jdl-muted">No description.</p>'}
            </div>
            ${attachHtml}
            ${detailsHtml}
            ${childrenHtml}
            ${activityHtml}
          </main>
          <aside class="jdl-side">${side}</aside>
        </div>
      </div>`;
  }

  function applyThemeClass(root) {
    const el = root || document.getElementById(ROOT_ID);
    if (!el) return;
    el.classList.toggle('jdl-dark', darkMode);
    el.dataset.theme = darkMode ? 'dark' : 'light';
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Linear-style issue view');
    document.documentElement.appendChild(root);
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-jdl-close]')) {
        tearDown(true);
        return;
      }
      if (e.target.closest('[data-jdl-theme]')) {
        setDark(!darkMode, true);
      }
    });
    return root;
  }

  function mount() {
    if (!enabled) return;
    document.documentElement.classList.add(HOST_CLASS);
    const root = ensureRoot();
    applyThemeClass(root);
    const data = scrapeIssue();
    const fp = fingerprint(data) + '::' + (darkMode ? 'd' : 'l');
    if (fp === lastFingerprint && root.dataset.ready === '1') return;
    lastFingerprint = fp;
    root.innerHTML = render(data);
    root.dataset.ready = '1';
    root.hidden = false;
    applyThemeClass(root);
  }

  function tearDown(disablePref) {
    document.documentElement.classList.remove(HOST_CLASS);
    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.hidden = true;
      root.innerHTML = '';
      root.dataset.ready = '0';
    }
    lastFingerprint = '';
    clearTimeout(bootTimer);
    clearTimeout(refreshTimer);
    if (disablePref) {
      enabled = false;
      darkMode = false;
      applyThemeClass();
      chrome.storage.sync.get('jiraDeclutter', (result) => {
        const state = {
          ...(result.jiraDeclutter || {}),
          linearView: false,
          linearDark: false
        };
        chrome.storage.sync.set({ jiraDeclutter: state });
      });
    }
  }

  function scheduleRefresh() {
    if (!enabled) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(mount, 400);
  }

  function setDark(on, persist) {
    const next = !!on;
    if (darkMode === next) {
      if (persist) {
        chrome.storage.sync.get('jiraDeclutter', (result) => {
          const state = { ...(result.jiraDeclutter || {}), linearDark: darkMode };
          chrome.storage.sync.set({ jiraDeclutter: state });
        });
      }
      return;
    }
    darkMode = next;
    applyThemeClass();
    if (enabled) {
      lastFingerprint = '';
      mount();
    }
    if (persist) {
      chrome.storage.sync.get('jiraDeclutter', (result) => {
        const state = { ...(result.jiraDeclutter || {}), linearDark: darkMode };
        chrome.storage.sync.set({ jiraDeclutter: state });
      });
    }
  }

  function setEnabled(on) {
    const next = !!on;
    if (enabled === next) return;

    clearTimeout(bootTimer);
    clearTimeout(refreshTimer);

    if (!next) {
      enabled = false;
      tearDown(false);
      return;
    }

    enabled = true;

    // Wake lazy comment bodies, then mount once
    document.documentElement.classList.remove(HOST_CLASS);
    wakeComments(findIssueRoot());
    bootTimer = setTimeout(() => {
      if (!enabled) return;
      mount();
    }, 400);
  }

  const observer = new MutationObserver(() => {
    if (!enabled) return;
    // Ignore our own overlay subtree (appended on <html>, not body) —
    // body mutations from Jira SPA still refresh content once, debounced.
    scheduleRefresh();
  });

  function startObserving() {
    if (!document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.body) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving);

  window.JDLinearView = {
    setEnabled,
    setDark,
    refresh: mount,
    isEnabled: () => enabled,
    isDark: () => darkMode
  };

  // Apply saved prefs once scripts are ready (content.js may have run earlier)
  try {
    chrome.storage.sync.get('jiraDeclutter', (result) => {
      const prefs = result?.jiraDeclutter || {};
      darkMode = prefs.linearDark === true;
      applyThemeClass();
      if (prefs.linearView === true) setEnabled(true);
    });
  } catch (_) {
    /* ignore */
  }
})();
