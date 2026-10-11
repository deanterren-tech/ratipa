#!/usr/bin/env bash
# Установка launchd-агента регулярного сбора «Пробег и связь» + история
# одометра (CAN-пробег) на macOS. Запускает scripts/navby-collect.ts каждые
# INTERVAL секунд БЕЗ участия пользователя и без открытого браузера.
#
#   ./scripts/install-navby-collect.sh                 # интервал 300 сек (5 минут)
#   ./scripts/install-navby-collect.sh 600             # свой интервал, сек
#   NODE_BIN=/path/to/node ./scripts/install-navby-collect.sh
#
# Переустановка безопасна (bootout + bootstrap). Проверка:
#   launchctl print gui/$(id -u)/com.ratipa.navby-collect
#   tail -f ~/.hermes/cache/scratch/navby-collect.log
# Удаление: ./scripts/uninstall-navby-collect.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SEC="${1:-300}"
LABEL="com.ratipa.navby-collect"
TEMPLATE="$PROJECT_DIR/deploy/launchd/${LABEL}.plist.template"
TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_FILE="${HOME}/.hermes/cache/scratch/navby-collect.log"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  # Запасной путь среды Hermes (этой машины), затем типовые установки.
  for cand in "$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin/node" /usr/local/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$cand" ]]; then NODE_BIN="$cand"; break; fi
  done
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node не найден. Установите Node.js или задайте NODE_BIN=/путь/к/node" >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

if [[ ! -f "$PROJECT_DIR/.env.local" ]] && [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Внимание: в $PROJECT_DIR нет .env.local/.env — сбор не сможет авторизоваться (NAVBY_*, FIREBASE_SERVICE_ACCOUNT_PATH)." >&2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG_FILE")"

sed \
  -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__NODE_DIR__|$NODE_DIR|g" \
  -e "s|__LOG_FILE__|$LOG_FILE|g" \
  -e "s|__INTERVAL_SEC__|$INTERVAL_SEC|g" \
  "$TEMPLATE" > "$TARGET"

# Переустановка: снять старую версию, если загружена.
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/${LABEL}"

echo "Установлено: $TARGET"
echo "  интервал: ${INTERVAL_SEC} сек; первое выполнение — сразу (RunAtLoad)"
echo "  лог:      ${LOG_FILE}"
echo "  статус:   launchctl print gui/$(id -u)/${LABEL} | head -20"
echo "  разово:   launchctl kickstart -k gui/$(id -u)/${LABEL}"
