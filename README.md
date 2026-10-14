# Avisos de disponibilidad de Amazon

El Cloudflare Worker comprueba cada 30 minutos la disponibilidad de estos
productos de Amazon España:

- `B0F2T6WM33`
- `B0F2TN43GH`

En cada comprobación envía al grupo de Telegram un resumen con el estado de los
dos productos: disponible, no disponible o no se pudo comprobar.

El estado genera como máximo una actualización mensual del repositorio para
evitar que GitHub desactive la tarea programada por inactividad.

## Configuración

1. Crea un repositorio público en GitHub y sube todos estos archivos.
2. Abre `Settings > Secrets and variables > Actions` en el repositorio.
3. Crea el secreto `TELEGRAM_BOT_TOKEN` con el token nuevo de BotFather.
4. Crea el secreto `TELEGRAM_CHAT_ID` con el identificador del grupo.
5. Abre `Actions > Comprobar disponibilidad` y pulsa `Run workflow`.

Una ejecución manual también envía el resumen actual a Telegram.

## Comprobación desde Telegram

El Cloudflare Worker de `worker/src/index.js` recibe el comando `/comprobar`
desde el grupo autorizado y consulta Amazon inmediatamente. Ignora los mensajes
de otros chats y valida la firma secreta del webhook de Telegram.

El Worker necesita estos secretos de Cloudflare:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

La tarea de GitHub Actions queda disponible para diagnósticos manuales, pero no
se ejecuta de forma programada porque Amazon bloquea las direcciones de GitHub.

Los secretos no deben escribirse en ningún archivo ni publicarse en mensajes.

## Obtener el identificador del grupo

Añade el bot al grupo y envía `/start` dentro del grupo. Después, desde esta
carpeta, ejecuta:

```zsh
read -s "TELEGRAM_BOT_TOKEN?Token nuevo: "
export TELEGRAM_BOT_TOKEN
python3 telegram_chat_id.py
unset TELEGRAM_BOT_TOKEN
```

El identificador de un grupo suele ser un número negativo. Guárdalo en GitHub
como `TELEGRAM_CHAT_ID`.

## Pruebas

```zsh
python3 -m unittest -v
```

Amazon puede cambiar su página o bloquear temporalmente las consultas
automáticas. En esos casos el mensaje indica que el producto no se pudo
comprobar y el último estado conocido se conserva.
