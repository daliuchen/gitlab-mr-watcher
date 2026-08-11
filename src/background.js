const DEFAULTS = {
  gitlabBaseUrl: "",
  accessToken: "",
  maxPages: "2",
  refreshIntervalMinutes: "5"
};

const CACHE_KEY = "mrCache";
const ALARM_NAME = "refreshGitlabMergeRequests";

chrome.runtime.onInstalled.addListener(() => {
  configureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  configureAlarm();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.gitlabBaseUrl || changes.accessToken || changes.maxPages || changes.refreshIntervalMinutes) {
    configureAlarm();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshMergeRequests();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refreshMergeRequests") {
    refreshMergeRequests()
      .then((cache) => sendResponse({ ok: true, cache }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "closeMergeRequest") {
    closeMergeRequest(message.mergeRequest)
      .then((cache) => sendResponse({ ok: true, cache }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function configureAlarm() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  await chrome.alarms.clear(ALARM_NAME);

  const minutes = Number(settings.refreshIntervalMinutes);
  if (!isConfigured(settings) || !minutes) {
    return;
  }

  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: Math.max(1, minutes)
  });
}

async function refreshMergeRequests() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (!isConfigured(settings)) {
    await chrome.action.setBadgeText({ text: "" });
    throw new Error("Configure your GitLab URL and access token first.");
  }

  const user = await gitlabFetch(settings, "/user");
  const [created, review] = await Promise.all([
    fetchMergeRequests(settings, "created_by_me"),
    fetchMergeRequests(settings, "reviews_for_me")
  ]);
  const projects = await fetchProjects(settings, [...created, ...review]);
  const cache = {
    user,
    created,
    review,
    projects,
    fetchedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  await chrome.action.setBadgeText({ text: review.length ? String(review.length) : "" });
  return cache;
}

async function closeMergeRequest(mergeRequest) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (!isConfigured(settings)) {
    throw new Error("Configure your GitLab URL and access token first.");
  }

  if (!mergeRequest?.project_id || !mergeRequest?.iid) {
    throw new Error("Missing MR project ID or IID, so it cannot be closed.");
  }

  const projectId = encodeURIComponent(mergeRequest.project_id);
  const mrIid = encodeURIComponent(mergeRequest.iid);
  await gitlabFetch(settings, `/projects/${projectId}/merge_requests/${mrIid}?state_event=close`, {
    method: "PUT"
  });

  const current = await chrome.storage.local.get({ [CACHE_KEY]: null });
  const cache = current[CACHE_KEY] || {
    user: null,
    created: [],
    review: [],
    projects: [],
    fetchedAt: new Date().toISOString()
  };

  const matchesClosed = (item) =>
    item.project_id === mergeRequest.project_id && item.iid === mergeRequest.iid;

  const nextCache = {
    ...cache,
    created: (cache.created || []).filter((item) => !matchesClosed(item)),
    review: (cache.review || []).filter((item) => !matchesClosed(item)),
    fetchedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [CACHE_KEY]: nextCache });
  await chrome.action.setBadgeText({
    text: nextCache.review.length ? String(nextCache.review.length) : ""
  });

  return nextCache;
}

async function fetchMergeRequests(settings, scope) {
  const maxPages = Number(settings.maxPages || DEFAULTS.maxPages);
  const result = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      state: "opened",
      scope,
      order_by: "updated_at",
      sort: "desc",
      per_page: "100",
      page: String(page)
    });

    const items = await gitlabFetch(settings, `/merge_requests?${params.toString()}`);
    result.push(...items);
    if (items.length < 100) break;
  }

  return result;
}

async function fetchProjects(settings, mergeRequests) {
  const ids = [...new Set(mergeRequests.map((mr) => mr.project_id))];
  const projects = [];

  await Promise.all(ids.map(async (id) => {
    try {
      projects.push(await gitlabFetch(settings, `/projects/${encodeURIComponent(id)}`));
    } catch {
      projects.push({
        id,
        name_with_namespace: `Project ${id}`,
        web_url: ""
      });
    }
  }));

  return projects;
}

async function gitlabFetch(settings, path, options = {}) {
  const response = await fetch(`${settings.gitlabBaseUrl}/api/v4${path}`, {
    method: options.method || "GET",
    headers: {
      "PRIVATE-TOKEN": settings.accessToken
    }
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.message ? `: ${body.message}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`GitLab request failed: HTTP ${response.status}${detail}`);
  }

  return response.json();
}

function isConfigured(settings) {
  return Boolean(settings.gitlabBaseUrl && settings.accessToken);
}
