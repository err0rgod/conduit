#!/usr/bin/env bash
set -euo pipefail

conduit_repository='err0rgod/conduit'
conduit_version=''
run_setup=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      conduit_version="${2:?--version requires a value}"
      shift 2
      ;;
    --no-setup)
      run_setup=false
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

for conduit_command in node npm curl unzip; do
  if ! command -v "$conduit_command" >/dev/null 2>&1; then
    echo "$conduit_command is required. Install Node.js 22 or newer and retry." >&2
    exit 1
  fi
done

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" -lt 22 ]]; then
  echo "Conduit requires Node.js 22 or newer; found $(node --version)." >&2
  exit 1
fi

if [[ -z "$conduit_version" ]]; then
  release_tag="$(curl -fsSL -H 'User-Agent: Conduit-Installer' "https://api.github.com/repos/$conduit_repository/releases/latest" | node -e "let data='';process.stdin.on('data',chunk=>data+=chunk).on('end',()=>process.stdout.write(JSON.parse(data).tag_name||''))")"
else
  release_tag="$conduit_version"
  [[ "$release_tag" == v* ]] || release_tag="v$release_tag"
fi
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid Conduit release tag: $release_tag" >&2
  exit 1
fi

release_version="${release_tag#v}"
release_base="https://github.com/$conduit_repository/releases/download/$release_tag"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/conduit-install.XXXXXXXX")"
trap 'rm -rf -- "$temporary_root"' EXIT
package_name="conduit-browser-$release_version.tgz"
extension_name="conduit-extension-$release_version.zip"

echo "Downloading Conduit $release_tag..."
curl -fsSL "$release_base/$package_name" -o "$temporary_root/$package_name"
curl -fsSL "$release_base/$extension_name" -o "$temporary_root/$extension_name"
curl -fsSL "$release_base/SHA256SUMS" -o "$temporary_root/SHA256SUMS"

verify_checksum() {
  local asset_name="$1"
  local expected
  local actual
  expected="$(awk -v name="$asset_name" '$2 == name { print $1; exit }' "$temporary_root/SHA256SUMS")"
  [[ -n "$expected" ]] || { echo "SHA256SUMS does not contain $asset_name." >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$temporary_root/$asset_name" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$temporary_root/$asset_name" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || { echo "Checksum verification failed for $asset_name." >&2; exit 1; }
}

verify_checksum "$package_name"
verify_checksum "$extension_name"

conduit_data_home="${XDG_DATA_HOME:-$HOME/.local/share}/conduit"
npm_root="$conduit_data_home/app"
bin_root="$HOME/.local/bin"
extension_root="$conduit_data_home/extension/$release_version"
mkdir -p "$npm_root" "$bin_root" "$extension_root"
npm install --prefix "$npm_root" --omit=dev --no-audit --no-fund "$temporary_root/$package_name"
unzip -oq "$temporary_root/$extension_name" -d "$extension_root"

cli_path="$npm_root/node_modules/conduit-browser/dist/cli.cjs"
[[ -f "$cli_path" ]] || { echo 'The installed Conduit CLI is missing.' >&2; exit 1; }
node_path="$(command -v node)"
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$node_path" "$cli_path" > "$bin_root/conduit"
chmod 700 "$bin_root/conduit"
export PATH="$bin_root:$PATH"

case "${SHELL:-}" in
  */zsh) shell_profile="$HOME/.zprofile" ;;
  *) shell_profile="$HOME/.profile" ;;
esac
if ! grep -Fq '# Conduit user commands' "$shell_profile" 2>/dev/null; then
  printf '\n# Conduit user commands\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$shell_profile"
fi

if [[ "$run_setup" == true ]]; then
  node "$cli_path" setup
fi

echo "Conduit $release_tag installed without administrator access."
echo "Extension folder: $extension_root"
echo 'Load that folder from chrome://extensions or edge://extensions using Developer mode.'
if [[ "$run_setup" == false ]]; then
  echo 'Run conduit setup before loading the extension.'
fi
