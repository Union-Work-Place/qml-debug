#!/usr/bin/env sh

set -eu

NODE_VERSION="22.13.0"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TOOLCHAIN_DIR=${QML_DEBUG_TOOLCHAIN_DIR:-"$REPO_ROOT/.local-toolchain"}

if [ "$#" -eq 0 ]; then
    echo "usage: $0 <command> [args...]" >&2
    exit 64
fi

have_supported_node() {
    if ! command -v node >/dev/null 2>&1; then
        return 1
    fi

    node -e '
        const required = [ 22, 13, 0 ];
        const current = process.versions.node.split(".").map(Number);
        const ok = current[0] > required[0]
            || (current[0] === required[0] && current[1] > required[1])
            || (current[0] === required[0] && current[1] === required[1] && current[2] >= required[2]);
        process.exit(ok ? 0 : 1);
    '
}

resolve_platform() {
    kernel=$(uname -s)
    arch=$(uname -m)

    case "$kernel" in
        Linux) platform="linux" ;;
        Darwin) platform="darwin" ;;
        *) echo "unsupported operating system: $kernel" >&2; exit 1 ;;
    esac

    case "$arch" in
        x86_64|amd64) target_arch="x64" ;;
        arm64|aarch64) target_arch="arm64" ;;
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
    esac

    DIST_NAME="node-v$NODE_VERSION-$platform-$target_arch"
}

ensure_local_node() {
    resolve_platform

    install_root="$TOOLCHAIN_DIR/$DIST_NAME"
    if [ -x "$install_root/bin/node" ]; then
        printf '%s\n' "$install_root"
        return 0
    fi

    mkdir -p "$TOOLCHAIN_DIR"
    archive="$TOOLCHAIN_DIR/$DIST_NAME.tar.xz"
    temp_archive="$archive.part"

    echo "Downloading Node.js v$NODE_VERSION for $DIST_NAME..." >&2
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$DIST_NAME.tar.xz" -o "$temp_archive"
    rm -rf "$install_root"
    tar -xJf "$temp_archive" -C "$TOOLCHAIN_DIR"
    mv "$temp_archive" "$archive"

    printf '%s\n' "$install_root"
}

if have_supported_node; then
    exec "$@"
fi

LOCAL_NODE_ROOT=$(ensure_local_node)
PATH="$LOCAL_NODE_ROOT/bin:$PATH"
export PATH

exec "$@"