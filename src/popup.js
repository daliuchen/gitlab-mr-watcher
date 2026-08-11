const DEFAULTS = {
  gitlabBaseUrl: "",
  accessToken: "",
  maxPages: "2",
  refreshIntervalMinutes: "5",
  hasSeenOnboarding: false,
  mrCache: null
};

const state = {
  activeTab: "created",
  settings: null,
  user: null,
  created: [],
  review: [],
  projects: new Map()
};

const accountLabel = document.querySelector("#accountLabel");
const closeButton = document.querySelector("#closeButton");
const copyButton = document.querySelector("#copyButton");
const onboardingPanel = document.querySelector("#onboardingPanel");
const refreshButton = document.querySelector("#refreshButton");
const settingsButton = document.querySelector("#settingsButton");
const skipOnboardingButton = document.querySelector("#skipOnboardingButton");
const startOnboardingButton = document.querySelector("#startOnboardingButton");
const setupButton = document.querySelector("#setupButton");
const setupNotice = document.querySelector("#setupNotice");
const statusEl = document.querySelector("#status");
const contentEl = document.querySelector("#content");
const createdCount = document.querySelector("#createdCount");
const reviewCount = document.querySelector("#reviewCount");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab;
    updateTabs();
    render();
  });
});

closeButton.addEventListener("click", () => window.close());
copyButton.addEventListener("click", copyCurrentList);
refreshButton.addEventListener("click", () => loadData());
settingsButton.addEventListener("click", openOptions);
skipOnboardingButton.addEventListener("click", dismissOnboarding);
startOnboardingButton.addEventListener("click", startOnboarding);
setupButton.addEventListener("click", openOptions);
contentEl.addEventListener("click", handleContentClick);

init();

async function init() {
  state.settings = await chrome.storage.local.get(DEFAULTS);
  if (!state.settings.hasSeenOnboarding && !isConfigured()) {
    showOnboarding();
    return;
  }

  if (!isConfigured()) {
    showSetup();
    return;
  }

  onboardingPanel.hidden = true;
  setupNotice.hidden = true;
  restoreCache(state.settings.mrCache);
  await loadData();
}

async function loadData() {
  refreshButton.disabled = true;
  setStatus(state.created.length || state.review.length ? "Refreshing GitLab in the background..." : "Loading GitLab...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "refreshMergeRequests" });
    if (!response?.ok) {
      throw new Error(response?.error || "Refresh failed");
    }

    applyCache(response.cache);
    setupNotice.hidden = true;
    render();
  } catch (error) {
    setStatus(error.message, "error");
    if (!state.created.length && !state.review.length) {
      contentEl.innerHTML = "";
    }
  } finally {
    refreshButton.disabled = false;
  }
}

function render() {
  const list = state[state.activeTab];
  copyButton.disabled = !list.length;

  if (!list.length) {
    contentEl.innerHTML = `<div class="empty">${state.activeTab === "created" ? "No open MRs created by you" : "No MRs waiting for your review"}</div>`;
    return;
  }

  const grouped = groupByProject(list);
  contentEl.innerHTML = grouped.map(({ project, items }) => `
    <article class="project-group">
      <header class="project-title">
        <span title="${escapeHtml(project.name_with_namespace)}">${escapeHtml(project.name_with_namespace)}</span>
        <span class="badge">${items.length}</span>
      </header>
      <div class="mr-list">
        ${items.map(renderMergeRequest).join("")}
      </div>
    </article>
  `).join("");
}

async function copyCurrentList() {
  const list = state[state.activeTab];
  if (!list.length) {
    setStatus("The current list is empty. Nothing to copy.");
    return;
  }

  const text = formatMergeRequestsForCopy(groupByProject(list));
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${list.length} MR link${list.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`, "error");
  }
}

function formatMergeRequestsForCopy(grouped) {
  const lines = [];

  grouped.forEach(({ project, items }, projectIndex) => {
    if (projectIndex > 0) {
      lines.push("");
    }

    lines.push(project.name_with_namespace);
    items.forEach((mr) => {
      lines.push(`- !${mr.iid} ${mr.title}`);
      lines.push(`  ${mr.web_url}`);
    });
  });

  return lines.join("\n");
}

function renderMergeRequest(mr) {
  const updated = mr.updated_at ? timeAgo(new Date(mr.updated_at)) : "";
  const source = `${mr.source_branch || ""} → ${mr.target_branch || ""}`;
  const draft = mr.draft || mr.work_in_progress;

  return `
    <article class="mr-item" data-url="${escapeHtml(mr.web_url)}" data-project-id="${escapeHtml(mr.project_id)}" data-iid="${escapeHtml(mr.iid)}">
      <div class="mr-open" role="button" tabindex="0" title="Open in a background tab">
        <div class="mr-title">${escapeHtml(mr.title)}</div>
        <div class="mr-meta">
          <span class="badge">!${mr.iid}</span>
          ${draft ? `<span class="badge draft">Draft</span>` : ""}
          <span>${escapeHtml(source)}</span>
          <span>${escapeHtml(updated)}</span>
        </div>
      </div>
      <button class="mr-close-button" type="button" title="Close this MR" aria-label="Close this MR">Close</button>
    </article>
  `;
}

function restoreCache(cache) {
  if (!cache) return;
  applyCache(cache);
  render();
}

function applyCache(cache) {
  state.user = cache.user;
  state.created = cache.created || [];
  state.review = cache.review || [];
  state.projects = new Map((cache.projects || []).map((project) => [project.id, project]));

  const host = new URL(state.settings.gitlabBaseUrl).host;
  accountLabel.textContent = `${state.user.name || state.user.username} @ ${host}`;
  createdCount.textContent = String(state.created.length);
  reviewCount.textContent = String(state.review.length);
  setStatus(`Last updated: ${formatTime(new Date(cache.fetchedAt))}`);
}

function handleContentClick(event) {
  const closeButton = event.target.closest(".mr-close-button");
  if (closeButton) {
    closeMergeRequest(closeButton.closest(".mr-item"), closeButton);
    return;
  }

  const openTarget = event.target.closest(".mr-open");
  if (openTarget) {
    openMergeRequest(openTarget.closest(".mr-item"));
  }
}

function openMergeRequest(link) {
  if (!link) return;
  const url = link.dataset.url;
  if (!url) return;

  chrome.tabs.create({ url, active: false });
}

async function closeMergeRequest(item, button) {
  if (!item) return;
  const mr = findMergeRequest(Number(item.dataset.projectId), Number(item.dataset.iid));
  if (!mr) return;

  const confirmed = confirm(`Close this MR?\n\n!${mr.iid} ${mr.title}`);
  if (!confirmed) return;

  button.disabled = true;
  setStatus(`Closing !${mr.iid}...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "closeMergeRequest",
      mergeRequest: {
        project_id: mr.project_id,
        iid: mr.iid
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Close failed");
    }

    applyCache(response.cache);
    render();
    setStatus(`Closed !${mr.iid}`);
  } catch (error) {
    button.disabled = false;
    setStatus(error.message, "error");
  }
}

function findMergeRequest(projectId, iid) {
  return [...state.created, ...state.review].find((mr) =>
    mr.project_id === projectId && mr.iid === iid
  );
}

contentEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const openTarget = event.target.closest(".mr-open");
  if (!openTarget) return;

  event.preventDefault();
  openMergeRequest(openTarget.closest(".mr-item"));
});

function groupByProject(mergeRequests) {
  const groups = new Map();
  mergeRequests.forEach((mr) => {
    const project = state.projects.get(mr.project_id) || {
      id: mr.project_id,
      name_with_namespace: `Project ${mr.project_id}`
    };
    if (!groups.has(project.id)) {
      groups.set(project.id, { project, items: [] });
    }
    groups.get(project.id).items.push(mr);
  });

  return [...groups.values()].sort((a, b) =>
    a.project.name_with_namespace.localeCompare(b.project.name_with_namespace)
  );
}

function updateTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
}

function showSetup() {
  accountLabel.textContent = "Not configured";
  onboardingPanel.hidden = true;
  setupNotice.hidden = false;
  setStatus("");
  contentEl.innerHTML = "";
}

function showOnboarding() {
  accountLabel.textContent = "Not configured";
  onboardingPanel.hidden = false;
  setupNotice.hidden = true;
  copyButton.disabled = true;
  setStatus("");
  contentEl.innerHTML = "";
}

async function dismissOnboarding() {
  await chrome.storage.local.set({ hasSeenOnboarding: true });
  state.settings.hasSeenOnboarding = true;
  showSetup();
}

async function startOnboarding() {
  await chrome.storage.local.set({ hasSeenOnboarding: true });
  state.settings.hasSeenOnboarding = true;
  openOptions();
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function isConfigured() {
  return Boolean(state.settings.gitlabBaseUrl && state.settings.accessToken);
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function formatTime(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
