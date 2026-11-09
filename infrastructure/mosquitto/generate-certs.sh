#!/bin/sh
# Generates a self-signed development CA and a server certificate for the
# Mosquitto TLS listener (8883). Development only: replace these certificates
# with a real CA before exposing the broker outside localhost.
set -eu

CERT_DIR="${CERT_DIR:-/mosquitto/certs}"

if ! command -v openssl >/dev/null 2>&1; then
  apk add --no-cache openssl >/dev/null
fi

if [ -f "$CERT_DIR/ca.crt" ] && [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  echo "TLS certificates already present in $CERT_DIR"
  exit 0
fi

mkdir -p "$CERT_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Generating development CA and Mosquitto server certificate..."

openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout "$CERT_DIR/ca.key" \
  -out "$CERT_DIR/ca.crt" \
  -subj "/CN=MediSense Development CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

cat >"$WORK_DIR/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:mosquitto,DNS:localhost,IP:127.0.0.1
EOF

openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$WORK_DIR/server.csr" \
  -subj "/CN=mosquitto"

openssl x509 -req \
  -in "$WORK_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" \
  -CAkey "$CERT_DIR/ca.key" \
  -CAcreateserial \
  -out "$CERT_DIR/server.crt" \
  -days 825 \
  -sha256 \
  -extfile "$WORK_DIR/server.ext"

# The Mosquitto broker and backend containers read these files as non-root.
chmod 644 "$CERT_DIR/ca.crt" "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
chmod 600 "$CERT_DIR/ca.key"

echo "Development TLS certificates generated in $CERT_DIR"
