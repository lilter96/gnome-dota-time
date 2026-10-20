#!/bin/bash
# Runs dota-time in a throwaway headless GNOME Shell 46 and takes screenshots.
#
# Your session is not touched: the shell gets its own session bus, dconf, XDG
# dirs, runtime dir and even $HOME, with a fake Steam in it, so the GSI config
# lands there and not in your Dota. It runs in the plain "user" mode: Ubuntu's
# mode loads Desktop Icons NG, whose init() kills every desktop-icons process
# of the user, including your session's.
#
#   tools/media/capture.sh smoke      # the real thing: Steam lookup, OpenDota, GSI
#   tools/media/capture.sh media      # demo data → docs/media
set -euo pipefail
mode=${1:-smoke}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=$here/out/$mode
rm -rf "$out"
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"/{config,state,cache} "$tmp/data/gnome-shell/extensions"
mkdir -m 700 "$tmp/runtime"
ln -s "$repo/dota-time@terentiy" "$here/dt-media@local" "$tmp/data/gnome-shell/extensions/"

steam=$tmp/home/.local/share/Steam
mkdir -p "$steam/config" "$steam/steamapps/common/dota 2 beta/game/dota/cfg"
if [ "$mode" = smoke ]; then
    for root in "$HOME/.steam/steam" "$HOME/.local/share/Steam"; do
        if [ -f "$root/config/loginusers.vdf" ]; then cp "$root/config/loginusers.vdf" "$steam/config/"; break; fi
    done
fi

export HOME=$tmp/home XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data XDG_STATE_HOME=$tmp/state \
    XDG_CACHE_HOME=$tmp/cache XDG_RUNTIME_DIR=$tmp/runtime DT_MEDIA_OUT=$out DT_MEDIA_MODE=$mode
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_ID GNOME_SHELL_SESSION_MODE
desktop_icons() { pgrep -f 'ding@rastersoft.com/app/ding.js' || true; }
icons_before=$(desktop_icons)
timeout 180 dbus-run-session -- bash -c '
    gsettings set org.gnome.shell enabled-extensions "[\"dota-time@terentiy\", \"dt-media@local\"]"
    gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    gsettings set org.gnome.desktop.interface scaling-factor 2
    [ -f "$XDG_CONFIG_HOME/dconf/user" ] || { echo "dconf is not isolated, stopping"; exit 3; }
    exec nice -n 10 gnome-shell --mode=user --headless --no-x11 --virtual-monitor 2560x2200
' 2>&1 | grep -E '\[dt-media\]|dota-time|JS ERROR|JS WARNING|stopping|Error|error' || true
[ "$(desktop_icons)" = "$icons_before" ] ||
    echo "warning: the desktop icons of your session were restarted during the capture" >&2
cfg="$steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/gamestate_integration_dota_time.cfg"
if [ -f "$cfg" ]; then echo "--- GSI config written:"; sed 's/"token".*/"token" <hidden>/' "$cfg"; fi
[ -f "$out/meta.json" ] || { echo "capture failed"; exit 1; }
[ "$mode" = media ] || exit 0

gjs -m "$here/compose.js" "$out" "$repo/docs/media"
ffmpeg -loglevel error -y -framerate 30 -i "$out/frames/seq_%04d.png" \
    -c:v libwebp_anim -lossless 0 -q:v 80 -compression_level 6 -loop 0 \
    "$repo/docs/media/demo.webp"
ls -l "$repo/docs/media"
