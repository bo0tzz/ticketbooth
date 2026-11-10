"use strict";

(() => {
  if (window.top !== window) return;

  const POLL_MS = 60_000;
  const PREWARM_MS = 30_000;
  const SPIN_MS = 5_000;
  const INITIAL_PROBES = 8;
  const RECAL_PROBES = 2;

  const now = () => performance.timeOrigin + performance.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  // Bounds on (server clock - local clock). The Date header is the server's
  // clock truncated to a whole second, so each response only says the offset
  // lies in a window about 1s wide. Intersecting windows from probes timed to
  // straddle the server's second boundary narrows that to roughly one RTT.
  let lo = -Infinity;
  let hi = Infinity;
  let rtts = [];
  let cached = false;
  let resets = 0;
  let probes = 0;

  const offset = () => (Number.isFinite(lo) ? (lo + hi) / 2 : 0);
  const serverNow = () => now() + offset();
  // The fastest recent sample is the closest to pure network latency; anything
  // slower includes server think time, which the reload must not wait out.
  const rtt = () => (rtts.length ? Math.min(...rtts) : 0);

  let run = 0;
  let phase = "idle";
  let armed = null;

  function report() {
    browser.runtime
      .sendMessage({
        type: "status",
        status: {
          phase,
          offset: offset(),
          uncertainty: Number.isFinite(lo) ? (hi - lo) / 2 : null,
          rtt: rtts.length ? rtt() : null,
          probes,
          resets,
          cached,
        },
      })
      .catch(() => {});
  }

  function setPhase(next) {
    phase = next;
    report();
  }

  async function probe() {
    const t0 = now();
    let res;
    try {
      res = await fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" });
    } catch {
      return;
    }
    const t1 = now();
    probes++;
    rtts.push(t1 - t0);
    if (rtts.length > 5) rtts.shift();

    const date = Date.parse(res.headers.get("date"));
    if (!Number.isFinite(date)) return;
    // A cache replays the origin's Date, which says nothing about the current time.
    if (res.headers.has("age")) {
      cached = true;
      return;
    }
    const sampleLo = date - t1;
    const sampleHi = date + 1000 - t0;
    if (Math.max(lo, sampleLo) > Math.min(hi, sampleHi)) {
      resets++;
      lo = sampleLo;
      hi = sampleHi;
    } else {
      lo = Math.max(lo, sampleLo);
      hi = Math.min(hi, sampleHi);
    }
  }

  // Sends the probe so that, if the current estimate is right, it reaches the
  // server exactly as its clock ticks over to a new second. Whichever second
  // comes back halves the remaining window.
  async function boundaryProbe() {
    if (Number.isFinite(lo)) {
      const arrival = serverNow() + rtt() / 2;
      await sleep(Math.ceil(arrival / 1000) * 1000 - arrival);
    }
    await probe();
  }

  async function calibrate(count, id, deadline) {
    for (let i = 0; i < count && id === run; i++) {
      // Each probe can wait up to a second for the boundary.
      if (i > 0 && deadline - serverNow() < 1500) break;
      await boundaryProbe();
      report();
    }
  }

  function spin(fireAt, id) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (id !== run) return;
      if (serverNow() >= fireAt) {
        location.reload();
      } else {
        channel.port2.postMessage(0);
      }
    };
    channel.port2.postMessage(0);
  }

  async function start(target, lead) {
    const id = ++run;
    armed = { target, lead };
    const left = () => target - serverNow();
    const live = () => id === run;

    setPhase("calibrating");
    await calibrate(INITIAL_PROBES, id, target - SPIN_MS);

    while (live() && left() > PREWARM_MS) {
      setPhase("waiting");
      await sleep(Math.min(POLL_MS, left() - PREWARM_MS));
      if (live() && left() > PREWARM_MS + POLL_MS / 2) {
        await calibrate(RECAL_PROBES, id, target - PREWARM_MS);
      }
    }
    if (!live()) return;

    if (left() > SPIN_MS + 1500) {
      setPhase("prewarming");
      await probe();
      report();
    }
    await sleep(left() - SPIN_MS);
    if (!live()) return;

    const fireAt = target - (rtt() / 2 + lead);
    if (serverNow() >= fireAt) {
      setPhase("missed");
      return;
    }
    setPhase("firing");
    spin(fireAt, id);
  }

  function stop() {
    run++;
    armed = null;
    setPhase("idle");
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "arm") start(msg.target, msg.lead);
    if (msg.type === "disarm") stop();
  });

  browser.runtime
    .sendMessage({ type: "hello" })
    .then((entry) => {
      if (entry && !armed) start(entry.target, entry.lead);
    })
    .catch(() => {});
})();
