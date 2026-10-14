#!/bin/sh
# que command-line launcher, shipped as que.app/Contents/Resources/cli/que.
# "Install 'que' command in PATH" symlinks it into /usr/local/bin or
# ~/.local/bin. It resolves its own symlinks to find the app bundle, then runs
# the bundled CLI with the app's own binary as Node.
set -e
self="$0"
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
cli_dir=$(cd "$(dirname "$self")" && pwd -P)
APP=$(cd "$cli_dir/../../.." && pwd -P)
if [ ! -x "$APP/Contents/MacOS/que" ]; then
  echo "que: cannot find the que app next to $cli_dir" >&2
  exit 127
fi
export ELECTRON_RUN_AS_NODE=1
exec "$APP/Contents/MacOS/que" "$APP/Contents/Resources/cli/index.js" "$@"
