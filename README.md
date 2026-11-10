# ticketbooth

<img src="extension/icon.svg" alt="" width="96" align="right" />

[![Build](https://github.com/bo0tzz/ticketbooth/actions/workflows/build.yml/badge.svg)](https://github.com/bo0tzz/ticketbooth/actions/workflows/build.yml)

ticketbooth is Firefox in a container. You use it in your browser through noVNC. An extension in it reloads a tab so that the request reaches the server at an exact moment.

It is for pages that open at a known time, for example a ticket sale that starts at 10:00:00.

**Without ticketbooth:**
> You watch a clock and press F5. Your clock is not the server's clock, and your request needs time to travel. You arrive early and see "not yet", or you arrive 400 ms late.

**With ticketbooth:**
> You enter 10:00:00 and arm the tab. The extension measures the server's clock and the network delay. It sends the reload so that the request arrives at 10:00:00 on the server's clock.

## Quick start

```sh
docker run --rm --shm-size=2g \
  -p 127.0.0.1:8080:8080 \
  -v ticketbooth-data:/data \
  -e TZ=Europe/Amsterdam \
  ghcr.io/bo0tzz/ticketbooth
```

Then open <http://localhost:8080>.

- `--shm-size=2g` is necessary. With Docker's default of 64 MB, Firefox tabs crash.
- The volume on `/data` holds the Firefox profile. Your logins stay after a restart.
- The image is for amd64 only.

## Security

By default, the port has no authentication. A person who can reach the port controls the browser and every account that is logged in.

- Bind the port to `127.0.0.1`, as in the example.
- If other machines must reach it, put a proxy with authentication in front of it.
- `VNC_PASSWORD` adds a VNC password. VNC uses only the first 8 characters, so do not use it as your only protection.

## Environment variables

All variables are optional.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | The HTTP port that noVNC listens on in the container. |
| `VNC_GEOMETRY` | `1600x900` | The screen size at startup. After you connect, the screen follows the size of your browser window. |
| `VNC_PASSWORD` | not set | Sets a VNC password. If it is not set, there is no password. |
| `TZ` | UTC | The time zone of the container, for example `Europe/Amsterdam`. The popup uses it when you type a time without a zone. |
| `TARGET_URL` | not set | Firefox opens this page at startup. |
| `TARGET_TIME` | not set | Arms the first page that loads. Use ISO 8601 with an offset, for example `2026-12-01T10:00:00+01:00`. |
| `LEAD_MS` | `5` | The lead for `TARGET_TIME`, in milliseconds. See [Lead](#lead). |

`TARGET_URL` and `TARGET_TIME` together start the container fully armed:

```sh
docker run --rm --shm-size=2g -p 127.0.0.1:8080:8080 -v ticketbooth-data:/data \
  -e TARGET_URL=https://example.com/sale \
  -e TARGET_TIME=2026-12-01T10:00:00+01:00 \
  -e LEAD_MS=0 \
  ghcr.io/bo0tzz/ticketbooth
```

## Usage

1. Open the page that you want to reload. Log in if the site needs it.
2. Click the ticket icon in the toolbar.
3. Type the target time.
4. Click **Arm this tab**.

The popup accepts these time formats:

| You type | Meaning |
|---|---|
| `10:00:00` or `10:00:00.250` | Today, in the time zone of the container. |
| `2026-12-01 10:00:00` | That date, in the time zone of the container. |
| `2026-12-01T10:00:00+01:00` | An exact moment. The time zone of the container has no effect. |

Below the field, the popup shows the time in UTC. Check it before you arm the tab.

The tab stays armed while you navigate in it. The reload applies to the page that the tab shows at the target time. The badge on the icon counts down. To cancel, click **Disarm**.

The popup also shows these values:

| Value | Meaning |
|---|---|
| State | The step that the tab is in. See the next section. |
| Countdown | The time until the target, on the server's clock. |
| Server time | The estimate of the server's clock. |
| Clock offset | The difference between the server's clock and the local clock, and how uncertain it is. |
| RTT | The round-trip time to the server. |

## How the timing works

T is the target time on the server's clock.

| When | State | What the tab does |
|---|---|---|
| When you arm it | `calibrating` | Sends 8 `HEAD` requests to measure the server's clock and the RTT. |
| Every 60 s | `waiting` | Measures again with 2 `HEAD` requests. Sets its timers again, so timer drift does not add up. |
| T-30 s | `prewarming` | Sends one `HEAD` request. This opens the connection that the reload will use. |
| T-5 s | `firing` | Starts a tight loop on a `MessageChannel`. A normal timer is not accurate enough here. |
| T-(RTT/2 + lead) | | Reloads the page. |
| After the reload | `fired` | Does nothing more. The tab is no longer armed. |

### The server's clock

The extension reads the `Date` header of each `HEAD` response. This header only has whole seconds. To get a better value, the extension sends each request so that it arrives when the server's clock moves to the next second. The answer shows if the estimate was early or late, and each answer cuts the error in half. After 8 requests, the error is about half of the RTT.

### Lead

The request needs about RTT/2 to reach the server. The lead is extra time on top of that.

| Lead | Where the request is aimed |
|---|---|
| `5` (default) | 5 ms before T. This allows for the time that Firefox needs to send the request. |
| `0` | Exactly at T. |
| `-20` | 20 ms after T. |

If the server refuses requests that arrive before T, use `0` or a negative lead. In a local test with an RTT near zero, a lead of `5` made the request arrive 2 ms before T.

## Limits

- **The accuracy depends on the RTT.** The clock estimate is only good to about half of the RTT. With an RTT of 40 ms, expect an error of up to 20 ms.
- **Caches break the calibration.** If the responses have an `Age` header, their `Date` is old. The popup shows a warning and the extension uses the local clock.
- **Some sites have many servers.** Their clocks can differ by some milliseconds. If the readings disagree, the popup shows a warning.
- **Keep the tab in front.** Firefox slows down timers in background tabs.
- **There is one attempt.** The extension reloads one time and does not try again.

## Development

[mise](https://mise.jdx.dev) installs the tools and runs the tasks.

| Task | What it does |
|---|---|
| `mise run lint` | Checks the extension, the shell script, the Dockerfile and the workflow. |
| `mise run build` | Builds the image as `ticketbooth`. |
| `mise run run` | Builds the image and runs it on <http://localhost:8080>. It passes `TZ`, `TARGET_URL`, `TARGET_TIME`, `LEAD_MS` and `VNC_PASSWORD` from your shell. |

The layout of the repository:

| Path | Contents |
|---|---|
| `extension/` | The Firefox extension. |
| `image/` | The entrypoint, the Firefox policies and the window manager configuration. |
| `Dockerfile` | The image: Debian, Firefox ESR, TigerVNC, openbox and noVNC. |
| `.github/workflows/build.yml` | Lints and builds on each push and pull request. A push to `main` publishes the image to `ghcr.io`. |

The image uses Firefox ESR because the release version of Firefox does not install unsigned extensions.
