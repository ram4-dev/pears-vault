#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="ram4-dev/pears-vault"
ARCHIVE_URL="https://github.com/${REPOSITORY}/archive/refs/heads/main.tar.gz"
INSTALL_ROOT="${HACKVAULT_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/hackvault}"
TEMP_DIR=""
STAGE_DIR=""
BACKUP_DIR=""

log() {
	printf '%s\n' "$*"
}

fail() {
	printf 'hackvault installer: %s\n' "$*" >&2
	exit 1
}

cleanup() {
	[[ -z "$STAGE_DIR" || ! -d "$STAGE_DIR" ]] || rm -rf "$STAGE_DIR"
	[[ -z "$TEMP_DIR" || ! -d "$TEMP_DIR" ]] || rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

choose_bin_dir() {
	if [[ -n "${HACKVAULT_BIN_DIR:-}" ]]; then
		printf '%s\n' "$HACKVAULT_BIN_DIR"
		return
	fi

	if [[ "$(uname -s)" == "Darwin" ]]; then
		local homebrew_bin=""
		if [[ -x "/opt/homebrew/bin/brew" ]]; then
			homebrew_bin="/opt/homebrew/bin"
		elif command -v brew >/dev/null 2>&1; then
			homebrew_bin="$(brew --prefix)/bin"
		fi
		if [[ -n "$homebrew_bin" && -d "$homebrew_bin" && -w "$homebrew_bin" ]]; then
			printf '%s\n' "$homebrew_bin"
			return
		fi
		if [[ -n "$homebrew_bin" ]]; then
			log "Homebrew bin is not writable; using $HOME/.local/bin instead." >&2
		fi
	fi

	printf '%s\n' "$HOME/.local/bin"
}

BIN_DIR="$(choose_bin_dir)"
WRAPPER_PATH="$BIN_DIR/hackvault"

uninstall() {
	local removed_wrapper="no"
	local recorded_bin=""
	if [[ -f "$INSTALL_ROOT/.bin-path" ]]; then
		IFS= read -r recorded_bin <"$INSTALL_ROOT/.bin-path"
		if [[ -n "$recorded_bin" ]]; then
			WRAPPER_PATH="$recorded_bin/hackvault"
		fi
	fi
	if [[ -e "$WRAPPER_PATH" ]]; then
		if grep -q '^# hackvault-installer-managed$' "$WRAPPER_PATH" 2>/dev/null; then
			rm -f "$WRAPPER_PATH"
			removed_wrapper="yes"
		else
			fail "refusing to remove unmanaged command at $WRAPPER_PATH"
		fi
	fi
	rm -rf "$INSTALL_ROOT"
	log "Uninstalled hackvault."
	log "  command: $WRAPPER_PATH ($removed_wrapper)"
	log "  files:   $INSTALL_ROOT"
}

case "${1:-}" in
--uninstall)
	[[ $# -eq 1 ]] || fail "--uninstall does not accept additional arguments"
	uninstall
	exit 0
	;;
"") ;;
*) fail "unknown option: $1" ;;
esac

for command in node npm; do
	command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done

SOURCE_DIR=""
resolve_source_dir() {
	if [[ -n "${HACKVAULT_SOURCE_DIR:-}" ]]; then
		SOURCE_DIR="$HACKVAULT_SOURCE_DIR"
		return
	fi

	local script_dir=""
	if [[ -f "${BASH_SOURCE[0]}" ]]; then
		script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	fi
	if [[ -n "$script_dir" && -f "$script_dir/../package.json" ]]; then
		SOURCE_DIR="$(cd "$script_dir/.." && pwd)"
		return
	fi

	command -v curl >/dev/null 2>&1 || fail "curl is required when installing from the network"
	command -v tar >/dev/null 2>&1 || fail "tar is required when installing from the network"
	TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hackvault-source.XXXXXX")"
	log "Downloading hackvault from https://github.com/${REPOSITORY} ..."
	curl -fsSL "$ARCHIVE_URL" -o "$TEMP_DIR/source.tar.gz"
	tar -xzf "$TEMP_DIR/source.tar.gz" -C "$TEMP_DIR"
	SOURCE_DIR="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'pears-vault-*' -print -quit)"
	[[ -n "$SOURCE_DIR" ]] || fail "downloaded archive did not contain the repository"
}

resolve_source_dir
[[ -f "$SOURCE_DIR/package.json" ]] || fail "package.json not found in $SOURCE_DIR"
[[ "$(node -p "require(process.argv[1]).name" "$SOURCE_DIR/package.json")" == "hackvault" ]] ||
	fail "source package is not named hackvault"

if [[ -e "$WRAPPER_PATH" ]] && ! grep -q '^# hackvault-installer-managed$' "$WRAPPER_PATH" 2>/dev/null; then
	fail "refusing to overwrite unmanaged command at $WRAPPER_PATH"
fi

log "Building hackvault from $SOURCE_DIR ..."
(
	cd "$SOURCE_DIR"
	npm install
	npm run build
)

[[ -f "$SOURCE_DIR/dist/cli.js" ]] || fail "build did not produce dist/cli.js"
mkdir -p "$(dirname "$INSTALL_ROOT")" "$BIN_DIR"
[[ -w "$BIN_DIR" ]] || fail "$BIN_DIR is not writable"

STAGE_DIR="$(mktemp -d "$(dirname "$INSTALL_ROOT")/.hackvault-stage.XXXXXX")"
cp -R "$SOURCE_DIR/dist" "$STAGE_DIR/dist"
if [[ -d "$SOURCE_DIR/skills" ]]; then
	cp -R "$SOURCE_DIR/skills" "$STAGE_DIR/skills"
fi
cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$STAGE_DIR/"
printf '%s\n' "$BIN_DIR" >"$STAGE_DIR/.bin-path"
[[ ! -f "$SOURCE_DIR/README.md" ]] || cp "$SOURCE_DIR/README.md" "$STAGE_DIR/"
(
	cd "$STAGE_DIR"
	npm install --omit=dev --ignore-scripts
)

BACKUP_DIR="${INSTALL_ROOT}.backup.$$"
rm -rf "$BACKUP_DIR"
if [[ -d "$INSTALL_ROOT" ]]; then
	mv "$INSTALL_ROOT" "$BACKUP_DIR"
fi
if ! mv "$STAGE_DIR" "$INSTALL_ROOT"; then
	[[ ! -d "$BACKUP_DIR" ]] || mv "$BACKUP_DIR" "$INSTALL_ROOT"
	fail "could not activate installation at $INSTALL_ROOT"
fi
STAGE_DIR=""
rm -rf "$BACKUP_DIR"
BACKUP_DIR=""

escaped_root="${INSTALL_ROOT//\'/\'\\\'\'}"
wrapper_tmp="${WRAPPER_PATH}.tmp.$$"
cat >"$wrapper_tmp" <<EOF_WRAPPER
#!/usr/bin/env bash
# hackvault-installer-managed
set -euo pipefail
INSTALL_ROOT='$escaped_root'
exec node "\$INSTALL_ROOT/dist/cli.js" "\$@"
EOF_WRAPPER
chmod 0755 "$wrapper_tmp"
mv "$wrapper_tmp" "$WRAPPER_PATH"

log "Installed hackvault."
log "  command: $WRAPPER_PATH"
log "  files:   $INSTALL_ROOT"
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
	log "Add $BIN_DIR to PATH to run: hackvault"
else
	log "Run: hackvault"
fi
