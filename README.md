# Jira Declutter — Chrome Extension

A lightweight Chrome extension that lets you hide the parts of Jira's issue detail page you don't need. Toggle sections on/off with simple switches — your preferences sync across devices.

## Install (Developer Mode)

1. Unzip `jira-declutter-extension.zip`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the unzipped folder
5. Open your Jira tab (e.g. `your-company.atlassian.net` or your company Jira URL) and **refresh the page** (required after Load unpacked)
6. Click the extension icon — use **Layout** toggles anywhere; open an issue for the detail toggles

## What you can hide

| Group          | Sections                                         |
|----------------|--------------------------------------------------|
| **Layout**     | Left sidebar, Top navigation bar, Issue full screen (modal) |
| **Main**       | Description, Attachments, Child issues, Linked issues, Activity/Comments |
| **Side Panel** | Details, Development, More fields, Automation, People, Dates, Time tracking, Sprint, Created/Updated |
| **Size & Font**| Main/side width, spacing, font size, font family |
| **Linear**     | Linear-style issue overlay (scrapes the open issue from the page DOM) |

## Linear view

Open an issue → extension popup → **Linear** tab → enable **Linear-style overlay**. Optionally enable **Dark mode** (also toggleable via the moon/sun button in the overlay). The content script reads title, description, status, assignee, labels, sub-issues, comments, and related fields from Jira’s DOM and renders a cleaner two-column UI. It’s read-only for now; close with ✕ or turn the toggle off.

## How it works

- Preferences are saved to Chrome sync storage (persists across devices if you're signed in)
- The extension adds CSS classes to `<html>` that hide targeted Jira DOM elements
- A MutationObserver handles Jira's SPA navigation so toggles survive page transitions
- **Reset All** restores everything to visible

## Customizing selectors

Jira's DOM changes occasionally. If a toggle stops working, edit `content.css` and update the selectors for that section. Each section is clearly labeled with comments.
