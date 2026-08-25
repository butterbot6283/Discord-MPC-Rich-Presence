#!/usr/bin/env sh
# Double-click launcher for KDE Plasma.
cd "$(dirname "$0")" || exit 1
export MPC_UI=kdialog
exec node --no-warnings menu.js
