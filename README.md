<p align="center">
  <img src="icons/icon-128.png" alt="GitLab MR Watcher icon" width="96" height="96" />
</p>

# GitLab MR Watcher

A local Chrome / Edge extension for viewing open GitLab merge requests related to you:

- MRs created by you
- MRs waiting for your review
- Project-grouped display
- Scheduled background refresh
- Opens MRs in a background tab so the popup stays open
- Closes MRs from the extension
- Copies the current list with project names and MR links
- First-run guide for setup
- Manual close button in the popup header
- Custom browser extension icon

## Install

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this directory: `/Users/cliu/WebstormProjects/gitlab-mr-watcher`.

## Build Packages

Create the Chrome package:

```sh
npm run build:chrome
```

Create the Firefox package:

```sh
npm run build:firefox
```

## Configure

Open the settings button in the extension popup and enter:

- GitLab URL, such as `https://gitlab.com` or your self-managed GitLab URL.
- Access token: for the simplest setup, create a GitLab access token with all scopes selected.
- Maximum items per list.
- Auto refresh interval.

## API Usage

The extension only requests the GitLab URL you configure:

- `GET /api/v4/user`
- `GET /api/v4/merge_requests?scope=created_by_me`
- `GET /api/v4/merge_requests?scope=reviews_for_me`
- `GET /api/v4/projects/:id`
- `PUT /api/v4/projects/:id/merge_requests/:merge_request_iid?state_event=close`

This extension is local-first. The access token and MR cache are stored only in local browser extension storage, requests go only to the GitLab URL you configure, and nothing is sent to any third-party service. The Firefox package declares `data_collection_permissions.required: ["none"]`.

Auto refresh uses `chrome.alarms`. While the browser is running, the extension refreshes on the configured interval and shows the number of MRs waiting for your review in the extension badge.
