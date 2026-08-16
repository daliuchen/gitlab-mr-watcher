const DEFAULTS = {
  gitlabBaseUrl: "",
  accessToken: "",
  maxPages: "2",
  refreshIntervalMinutes: "5"
};

const CACHE_KEY = "mrCache";
const IGNORED_KEY = "ignoredMergeRequests";
const SEEN_KEY = "mrSeenState";
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

  if (message?.type === "closeMergeRequests") {
    closeMergeRequests(message.mergeRequests)
      .then((cache) => sendResponse({ ok: true, cache }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ignoreMergeRequest") {
    ignoreMergeRequest(message.mergeRequest)
      .then((cache) => sendResponse({ ok: true, cache }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "getIgnoredMergeRequests") {
    getIgnoredMergeRequests()
      .then((ignored) => sendResponse({ ok: true, ignored }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "unignoreMergeRequest") {
    unignoreMergeRequest(message.mergeRequest)
      .then((result) => sendResponse({ ok: true, ...result }))
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
  const enriched = await markMergeRequestActivity([...created, ...review]);
  const enrichedByKey = new Map(enriched.map((mr) => [mergeRequestKey(mr), mr]));
  const visibleCreated = created
    .map((mr) => enrichedByKey.get(mergeRequestKey(mr)))
    .filter(Boolean);
  const visibleReview = review
    .map((mr) => enrichedByKey.get(mergeRequestKey(mr)))
    .filter(Boolean);
  const projects = await fetchProjects(settings, [...visibleCreated, ...visibleReview]);
  const cache = {
    user,
    created: visibleCreated,
    review: visibleReview,
    projects,
    fetchedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  await chrome.action.setBadgeText({ text: visibleReview.length ? String(visibleReview.length) : "" });
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

async function closeMergeRequests(mergeRequests) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (!isConfigured(settings)) {
    throw new Error("Configure your GitLab URL and access token first.");
  }

  if (!Array.isArray(mergeRequests) || !mergeRequests.length) {
    throw new Error("No merge requests were selected for closing.");
  }

  for (const mergeRequest of mergeRequests) {
    if (!mergeRequest?.project_id || !mergeRequest?.iid) {
      throw new Error("A selected MR is missing its project ID or IID.");
    }

    const projectId = encodeURIComponent(mergeRequest.project_id);
    const mrIid = encodeURIComponent(mergeRequest.iid);
    await gitlabFetch(settings, `/projects/${projectId}/merge_requests/${mrIid}?state_event=close`, {
      method: "PUT"
    });
  }

  const current = await chrome.storage.local.get({ [CACHE_KEY]: null });
  const cache = current[CACHE_KEY] || {
    user: null,
    created: [],
    review: [],
    projects: [],
    fetchedAt: new Date().toISOString()
  };
  const closedKeys = new Set(mergeRequests.map(mergeRequestKey));
  const nextCache = {
    ...cache,
    created: (cache.created || []).filter((item) => !closedKeys.has(mergeRequestKey(item))),
    review: (cache.review || []).filter((item) => !closedKeys.has(mergeRequestKey(item))),
    fetchedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [CACHE_KEY]: nextCache });
  await chrome.action.setBadgeText({
    text: nextCache.review.length ? String(nextCache.review.length) : ""
  });

  return nextCache;
}

async function ignoreMergeRequest(mergeRequest) {
  if (!mergeRequest?.project_id || !mergeRequest?.iid) {
    throw new Error("Missing MR project ID or IID, so it cannot be ignored.");
  }

  const key = mergeRequestKey(mergeRequest);
  const current = await chrome.storage.local.get({
    [CACHE_KEY]: null,
    [IGNORED_KEY]: []
  });
  const ignored = normalizeIgnored(current[IGNORED_KEY]);
  ignored.set(key, {
    project_id: mergeRequest.project_id,
    iid: mergeRequest.iid,
    title: mergeRequest.title || "",
    web_url: mergeRequest.web_url || "",
    ignored_at: new Date().toISOString()
  });

  const cache = current[CACHE_KEY] || {
    user: null,
    created: [],
    review: [],
    projects: [],
    fetchedAt: new Date().toISOString()
  };
  const nextCache = removeMergeRequestFromCache(cache, mergeRequest);

  await chrome.storage.local.set({
    [CACHE_KEY]: nextCache,
    [IGNORED_KEY]: [...ignored.values()]
  });
  await chrome.action.setBadgeText({
    text: nextCache.review.length ? String(nextCache.review.length) : ""
  });

  return nextCache;
}

async function getIgnoredMergeRequests() {
  const current = await chrome.storage.local.get({ [IGNORED_KEY]: [] });
  return [...normalizeIgnored(current[IGNORED_KEY]).values()];
}

async function unignoreMergeRequest(mergeRequest) {
  if (!mergeRequest?.project_id || !mergeRequest?.iid) {
    throw new Error("Missing MR project ID or IID, so it cannot be unignored.");
  }

  const key = mergeRequestKey(mergeRequest);
  const current = await chrome.storage.local.get({ [IGNORED_KEY]: [] });
  const ignored = normalizeIgnored(current[IGNORED_KEY]);
  ignored.delete(key);
  await chrome.storage.local.set({ [IGNORED_KEY]: [...ignored.values()] });

  let cache = null;
  try {
    cache = await refreshMergeRequests();
  } catch {
    cache = null;
  }

  return { ignored: [...ignored.values()], cache };
}

async function markMergeRequestActivity(mergeRequests) {
  const current = await chrome.storage.local.get({
    [SEEN_KEY]: {},
    [IGNORED_KEY]: []
  });
  const ignored = new Set(normalizeIgnored(current[IGNORED_KEY]).keys());
  const previous = current[SEEN_KEY] || {};
  const next = {};

  const visible = mergeRequests
    .filter((mr) => !ignored.has(mergeRequestKey(mr)))
    .map((mr) => {
      const key = mergeRequestKey(mr);
      const previousEntry = previous[key];
      const activity = !previousEntry
        ? "new"
        : previousEntry.updated_at !== mr.updated_at
          ? "updated"
          : "";

      next[key] = {
        project_id: mr.project_id,
        iid: mr.iid,
        updated_at: mr.updated_at,
        seen_at: previousEntry?.seen_at || new Date().toISOString()
      };

      return {
        ...mr,
        watcher_activity: activity
      };
    });

  await chrome.storage.local.set({ [SEEN_KEY]: next });
  return visible;
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

function removeMergeRequestFromCache(cache, mergeRequest) {
  const matches = (item) =>
    item.project_id === mergeRequest.project_id && item.iid === mergeRequest.iid;

  return {
    ...cache,
    created: (cache.created || []).filter((item) => !matches(item)),
    review: (cache.review || []).filter((item) => !matches(item)),
    fetchedAt: new Date().toISOString()
  };
}

function mergeRequestKey(mergeRequest) {
  return `${mergeRequest.project_id}:${mergeRequest.iid}`;
}

function normalizeIgnored(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const byKey = new Map();

  list.forEach((entry) => {
    if (typeof entry === "string") {
      const [projectId, iid] = entry.split(":");
      byKey.set(entry, {
        project_id: Number(projectId),
        iid: Number(iid),
        title: "",
        web_url: "",
        ignored_at: null
      });
      return;
    }

    if (entry && entry.project_id != null && entry.iid != null) {
      byKey.set(mergeRequestKey(entry), {
        project_id: entry.project_id,
        iid: entry.iid,
        title: entry.title || "",
        web_url: entry.web_url || "",
        ignored_at: entry.ignored_at || null
      });
    }
  });

  return byKey;
}
