const DEFAULTS = {
  gitlabBaseUrl: "",
  accessToken: "",
  maxPages: "2",
  refreshIntervalMinutes: "5"
};

const form = document.querySelector("#settingsForm");
const baseUrlInput = document.querySelector("#gitlabBaseUrl");
const tokenInput = document.querySelector("#accessToken");
const maxPagesSelect = document.querySelector("#maxPages");
const refreshIntervalSelect = document.querySelector("#refreshIntervalMinutes");
const statusEl = document.querySelector("#status");
const testButton = document.querySelector("#testButton");

init();

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  baseUrlInput.value = settings.gitlabBaseUrl;
  tokenInput.value = settings.accessToken;
  maxPagesSelect.value = settings.maxPages;
  refreshIntervalSelect.value = settings.refreshIntervalMinutes;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readForm();
  await chrome.storage.local.set(settings);
  setStatus("Saved. Refreshing MR data...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "refreshMergeRequests" });
    if (!response?.ok) {
      throw new Error(response?.error || "Refresh failed");
    }
    setStatus("Saved and refreshed successfully.", "success");
  } catch (error) {
    setStatus(`Saved, but refresh failed: ${error.message}`, "error");
  }
});

testButton.addEventListener("click", async () => {
  const settings = readForm();
  testButton.disabled = true;
  setStatus("Testing connection...");

  try {
    const user = await gitlabFetch(settings, "/user");
    setStatus(`Connected as ${user.name || user.username} (@${user.username})`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    testButton.disabled = false;
  }
});

function readForm() {
  return {
    gitlabBaseUrl: normalizeBaseUrl(baseUrlInput.value),
    accessToken: tokenInput.value.trim(),
    maxPages: maxPagesSelect.value,
    refreshIntervalMinutes: refreshIntervalSelect.value
  };
}

async function gitlabFetch(settings, path) {
  if (!settings.gitlabBaseUrl || !settings.accessToken) {
    throw new Error("Enter a GitLab URL and access token.");
  }

  const response = await fetch(`${settings.gitlabBaseUrl}/api/v4${path}`, {
    headers: {
      "PRIVATE-TOKEN": settings.accessToken
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab request failed: HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}
