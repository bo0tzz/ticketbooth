"use strict";

const $ = (id) => document.getElementById(id);

// Accepts anything Date.parse does, plus "YYYY-MM-DD HH:MM:SS" and a bare
// "HH:MM[:SS[.mmm]]" meaning today. Without a zone it is the browser's local time.
function parseTarget(text) {
  let value = text.trim();
  if (/^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    if (value.indexOf(":") === 1) value = `0${value}`;
    value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${value}`;
  }
  return Date.parse(value.replace(" ", "T"));
}

function formatDuration(ms) {
  if (ms <= 0) return "0.0s";
  const s = ms / 1000;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1);
  return (h ? `${h}h ` : "") + (h || m ? `${m}m ` : "") + `${rest}s`;
}

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatTime(ms) {
  const d = new Date(ms);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

let tabId;

function showResolved() {
  const target = parseTarget($("target").value);
  $("resolved").textContent = Number.isFinite(target)
    ? `${new Date(target).toISOString()} (input read as ${zone})`
    : "";
}

async function refresh() {
  const entry = await browser.runtime.sendMessage({ type: "get", tabId });
  const status = entry?.status;
  const offset = status?.offset ?? 0;

  $("phase").textContent = entry ? (status?.phase ?? "starting") : "idle";
  $("countdown").textContent = entry ? formatDuration(entry.target - (Date.now() + offset)) : "-";
  $("server").textContent = status ? formatTime(Date.now() + offset) : "-";
  $("offset").textContent =
    status?.uncertainty != null ? `${offset.toFixed(0)} ± ${status.uncertainty.toFixed(0)} ms` : "-";
  $("rtt").textContent = status?.rtt != null ? `${status.rtt.toFixed(1)} ms` : "-";

  const warnings = [];
  if (status?.cached) {
    warnings.push("Responses come from a cache (Age header), so their Date cannot be used for calibration.");
  }
  if (status?.resets > 1) {
    warnings.push(`Server clock readings disagreed ${status.resets} times; the offset may be unreliable.`);
  }
  if (status && status.uncertainty == null && status.probes > 0 && !status.cached) {
    warnings.push("No usable Date header; using the local clock.");
  }
  $("warning").textContent = warnings.join(" ");
}

$("target").addEventListener("input", showResolved);

$("arm").addEventListener("click", async () => {
  const target = parseTarget($("target").value);
  const lead = Number($("lead").value);
  if (!Number.isFinite(target) || !Number.isFinite(lead)) {
    $("error").textContent = "Cannot parse the target time.";
    return;
  }
  const res = await browser.runtime.sendMessage({ type: "arm", tabId, target, lead });
  $("error").textContent = res?.error ?? "";
  refresh();
});

$("disarm").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "disarm", tabId });
  $("error").textContent = "";
  refresh();
});

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  const entry = await browser.runtime.sendMessage({ type: "get", tabId });
  if (entry) {
    $("target").value = new Date(entry.target).toISOString();
    $("lead").value = entry.lead;
    showResolved();
  }
  refresh();
  setInterval(refresh, 100);
})();
