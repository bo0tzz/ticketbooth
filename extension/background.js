"use strict";

const DEFAULT_LEAD_MS = 5;

// tabId -> { target, lead, state: "armed" | "firing", status }
const tabs = new Map();

let preset = null;
const ready = browser.storage.managed
  .get()
  .then((cfg) => {
    const target = Date.parse(cfg.targetTime);
    if (Number.isFinite(target)) {
      const lead = Number(cfg.leadMs);
      preset = { target, lead: Number.isFinite(lead) ? lead : DEFAULT_LEAD_MS };
    } else if (cfg.targetTime) {
      console.error(`ticketbooth: cannot parse TARGET_TIME "${cfg.targetTime}"`);
    }
  })
  // Rejects when no managed storage is configured, i.e. no preset.
  .catch(() => {});

function arm(tabId, target, lead) {
  tabs.set(tabId, { target, lead, state: "armed", status: null });
}

async function onContentMessage(msg, tabId) {
  await ready;
  switch (msg.type) {
    case "hello": {
      if (preset) {
        arm(tabId, preset.target, preset.lead);
        preset = null;
      }
      const entry = tabs.get(tabId);
      if (entry?.status?.phase === "firing") entry.status.phase = "fired";
      return entry?.state === "armed" ? { target: entry.target, lead: entry.lead } : null;
    }
    case "status": {
      const entry = tabs.get(tabId);
      if (entry) {
        entry.status = msg.status;
        // Marked before the reload so the freshly loaded page does not re-arm itself.
        if (msg.status.phase === "firing" || msg.status.phase === "missed") {
          entry.state = "firing";
        }
      }
      return null;
    }
  }
  return null;
}

async function onPopupMessage(msg) {
  switch (msg.type) {
    case "arm":
      arm(msg.tabId, msg.target, msg.lead);
      try {
        await browser.tabs.sendMessage(msg.tabId, { type: "arm", target: msg.target, lead: msg.lead });
      } catch {
        tabs.delete(msg.tabId);
        return { error: "This page cannot be armed (not an http(s) page, or still loading)." };
      }
      return {};
    case "disarm":
      tabs.delete(msg.tabId);
      browser.browserAction.setBadgeText({ tabId: msg.tabId, text: "" });
      browser.tabs.sendMessage(msg.tabId, { type: "disarm" }).catch(() => {});
      return {};
    case "get":
      return tabs.get(msg.tabId) ?? null;
  }
  return null;
}

browser.runtime.onMessage.addListener((msg, sender) =>
  sender.tab ? onContentMessage(msg, sender.tab.id) : onPopupMessage(msg),
);

browser.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));

function badge(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

browser.browserAction.setBadgeBackgroundColor({ color: "#b3261e" });
setInterval(() => {
  for (const [tabId, entry] of tabs) {
    const left = entry.target - (Date.now() + (entry.status?.offset ?? 0));
    const text = entry.state === "armed" && left > 0 ? badge(left) : "";
    browser.browserAction.setBadgeText({ tabId, text }).catch(() => {});
  }
}, 1000);
