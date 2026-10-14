#!/usr/bin/env python3

import json
import os
import sys
import urllib.error
import urllib.request


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Falta la variable TELEGRAM_BOT_TOKEN")

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram ha rechazado la consulta: {details}") from error

    chats = {}
    for update in result.get("result", []):
        for key in ("message", "channel_post", "my_chat_member"):
            event = update.get(key, {})
            chat = event.get("chat")
            if chat:
                chats[str(chat["id"])] = chat.get("title") or chat.get("username") or "Chat"

    if not chats:
        print("No se encontraron chats. Envía /start en el grupo y vuelve a intentarlo.")
        return

    print("Chats encontrados:")
    for chat_id, name in chats.items():
        print(f"{name}: {chat_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
