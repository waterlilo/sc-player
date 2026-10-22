# Caddy with the forward-proxy plugin: an HTTPS proxy (TLS to the proxy, so the network in between only sees
# this server's name) with a certificate from Let's Encrypt, obtained and renewed by Caddy itself.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddyserver/forwardproxy

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
