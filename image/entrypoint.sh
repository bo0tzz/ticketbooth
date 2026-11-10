#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:0
: "${PORT:=8080}"
: "${VNC_GEOMETRY:=1600x900}"

jq \
  --arg time "${TARGET_TIME:-}" \
  --arg lead "${LEAD_MS:-}" \
  'if $time != "" then
     .policies."3rdparty".Extensions."ticketbooth@ticketbooth" =
       ({ targetTime: $time } + (if $lead != "" then { leadMs: ($lead | tonumber) } else {} end))
   else . end' \
  /opt/ticketbooth/policies.json >/etc/firefox/policies/policies.json

vnc_auth=(-SecurityTypes None)
if [[ -n "${VNC_PASSWORD:-}" ]]; then
  tigervncpasswd -f <<<"$VNC_PASSWORD" >/tmp/vncpasswd
  vnc_auth=(-SecurityTypes VncAuth -PasswordFile /tmp/vncpasswd)
fi

Xtigervnc "$DISPLAY" -localhost -geometry "$VNC_GEOMETRY" -depth 24 "${vnc_auth[@]}" &
until [[ -S /tmp/.X11-unix/X0 ]]; do sleep 0.1; done

openbox --config-file /opt/ticketbooth/openbox-rc.xml &
websockify --web /usr/share/novnc "$PORT" localhost:5900 &

mkdir -p /data/profile
firefox-esr --profile /data/profile --no-remote ${TARGET_URL:+"$TARGET_URL"} &

# Any of them exiting takes the container down, so the restart policy brings it all back.
wait -n
