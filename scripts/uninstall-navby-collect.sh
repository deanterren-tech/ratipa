#!/usr/bin/env bash
# Удаление launchd-агента регулярного сбора «Пробег и связь» + история
# одометра. Данные в RTDB не трогаются.
set -euo pipefail
LABEL="com.ratipa.navby-collect"
TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$TARGET"
echo "Агент ${LABEL} снят, шаблон ${TARGET} удалён."
echo "(Лог-файлы в ~/.hermes/cache/scratch/navby-collect.log* оставлены для истории.)"
