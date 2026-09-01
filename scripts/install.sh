#!/usr/bin/env bash
set -euo pipefail

conduit_repository='err0rgod/conduit'
skill_directory_url='https://github.com/err0rgod/skills/tree/main/conduit'
skill_entry_url='https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md'
chrome_store_url='https://chromewebstore.google.com/detail/conduit-extension/gjhipjgiapijcdnflldnoenafeegmfpc'
extension_release_url='https://github.com/err0rgod/conduit-extension/releases/tag/v0.1.3'
extension_archive_url='https://github.com/err0rgod/conduit-extension/releases/download/v0.1.3/conduit-extension-unpacked-v0.1.3.zip'
firefox_addon_url='https://addons.mozilla.org/en-US/firefox/addon/conduit/'
edge_store_url='https://microsoftedge.microsoft.com/addons/search/conduit'
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

for conduit_command in node npm curl; do
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

resolve_release_tag() {
  local repository="$1"
  local requested_version="$2"
  local component_name="$3"
  local tag
  if [[ -z "$requested_version" ]]; then
    tag="$(curl -fsSL -H 'User-Agent: Conduit-Installer' "https://api.github.com/repos/$repository/releases/latest" | node -e "let data='';process.stdin.on('data',chunk=>data+=chunk).on('end',()=>process.stdout.write(JSON.parse(data).tag_name||''))")"
  else
    tag="$requested_version"
    [[ "$tag" == v* ]] || tag="v$tag"
  fi
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Invalid $component_name release tag: $tag" >&2
    exit 1
  fi
  printf '%s\n' "$tag"
}

release_tag="$(resolve_release_tag "$conduit_repository" "$conduit_version" 'Conduit')"
release_version="${release_tag#v}"
release_base="https://github.com/$conduit_repository/releases/download/$release_tag"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/conduit-install.XXXXXXXX")"
trap 'rm -rf -- "$temporary_root"' EXIT
package_name="conduit-browser-$release_version.tgz"

echo "Downloading Conduit backend $release_tag..."
curl -fsSL "$release_base/$package_name" -o "$temporary_root/$package_name"
curl -fsSL "$release_base/SHA256SUMS" -o "$temporary_root/SHA256SUMS"

verify_checksum() {
  local asset_name="$1"
  local checksum_file="$2"
  local expected
  local actual
  expected="$(awk -v name="$asset_name" '$2 == name { print $1; exit }' "$checksum_file")"
  [[ -n "$expected" ]] || { echo "$checksum_file does not contain $asset_name." >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$temporary_root/$asset_name" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$temporary_root/$asset_name" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || { echo "Checksum verification failed for $asset_name." >&2; exit 1; }
}

verify_checksum "$package_name" "$temporary_root/SHA256SUMS"
conduit_data_home="${XDG_DATA_HOME:-$HOME/.local/share}/conduit"
npm_root="$conduit_data_home/app"
bin_root="$HOME/.local/bin"
mkdir -p "$npm_root" "$bin_root"
npm install --prefix "$npm_root" --omit=dev --no-audit --no-fund "$temporary_root/$package_name"

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

echo "Conduit backend $release_tag installed without administrator access."
echo 'Next: install Conduit Extension from the browser store.'
echo "Chrome and Brave store: $chrome_store_url"
echo "GitHub fallback for development or recovery: $extension_archive_url"
echo "Release page: $extension_release_url"
echo 'Extract the ZIP, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the folder containing manifest.json.'
echo "Microsoft Edge: $edge_store_url"
echo "Firefox Add-ons (approved): $firefox_addon_url"
echo 'The unpacked development extension ID is trusted by default.'
echo 'For a future store listing, run conduit extension trust <extension-id> once.'
echo "Agent Skill directory: $skill_directory_url"
echo "Agent Skill entry: $skill_entry_url"
echo 'Use the skill directory or SKILL.md URL with any Agent Skills-compatible AI harness.'
if [[ "$run_setup" == false ]]; then
  echo 'Run conduit setup before installing the extension.'
fi
