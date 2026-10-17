#!/bin/sh
set -eu

# This template is versioned by npm run package.
version='@VERSION@'
cd -- "$(dirname -- "$0")"
command -v docker >/dev/null 2>&1 || { echo 'Install Docker with Compose first.' >&2; exit 1; }
docker compose version >/dev/null
if ! docker image inspect "audiocity:$version" >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || { echo 'Install curl first.' >&2; exit 1; }
  case "$(docker info --format '{{.OSType}}/{{.Architecture}}')" in
    linux/x86_64|linux/amd64) arch=amd64 ;;
    linux/aarch64|linux/arm64) arch=arm64 ;;
    *) echo 'Use a Linux amd64 or arm64 Docker daemon.' >&2; exit 1 ;;
  esac
  if command -v sha256sum >/dev/null 2>&1; then
    checksum=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    checksum='shasum -a 256'
  else
    echo 'Install sha256sum or shasum first.' >&2; exit 1
  fi
  download_dir=$(mktemp -d)
  trap 'rm -rf "$download_dir"' EXIT
  trap 'exit 1' HUP INT TERM
  base="https://github.com/mindscaper-org/audiocity/releases/download/v$version"
  image="audiocity-$version-docker-$arch.tar.gz"
  curl --fail --location --retry 3 "$base/SHA256SUMS" -o "$download_dir/SHA256SUMS"
  curl --fail --location --retry 3 "$base/$image" -o "$download_dir/$image"
  expected=$(awk -v name="$image" '$2 == name { print $1 }' "$download_dir/SHA256SUMS")
  actual=$($checksum "$download_dir/$image" | awk '{ print $1 }')
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo 'Image checksum verification failed.' >&2; exit 1
  fi
  docker load -i "$download_dir/$image"
fi
docker compose up -d --wait
echo 'Audiocity started. Open http://localhost:8080 (or your configured URL).'
echo 'Run docker compose logs audiocity to get the first-run administrator password.'
