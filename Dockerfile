FROM debian:13-slim

ARG EXTENSION_VERSION=0.0.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" >/etc/apt/sources.list.d/mozilla.list \
    && printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' >/etc/apt/preferences.d/mozilla \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        firefox-esr \
        fonts-liberation \
        fonts-noto-color-emoji \
        jq \
        novnc \
        openbox \
        tigervnc-standalone-server \
        tigervnc-tools \
        tini \
        tzdata \
        websockify \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 1000 --home-dir /data --create-home app \
    && install -d -o app -g app /etc/firefox/policies \
    && install -d -m 1777 /tmp/.X11-unix

COPY image/ /opt/ticketbooth/
COPY extension/ /tmp/extension/

# The unsigned extension is only installable on ESR. The version is stamped so
# an existing profile picks up the extension from a newer image.
WORKDIR /tmp/extension
RUN jq --arg v "$EXTENSION_VERSION" '.version = $v' manifest.json >manifest.tmp \
    && mv manifest.tmp manifest.json \
    && python3 -m zipfile -c /opt/ticketbooth/ticketbooth.xpi ./* \
    && rm -rf /tmp/extension \
    && cp /opt/ticketbooth/index.html /usr/share/novnc/index.html

USER 1000:1000
WORKDIR /data
ENV HOME=/data
VOLUME /data
EXPOSE 8080

ENTRYPOINT ["tini", "--", "/opt/ticketbooth/entrypoint.sh"]
