# Avisos de disponibilidad de Amazon

Comprueba cada 15 minutos la disponibilidad de estos productos de Amazon España:

- `B0F2T6WM33`
- `B0F2TN43GH`

Cuando uno pasa a estar disponible, envía un aviso a un grupo de Telegram. No
repite el aviso mientras el producto siga disponible.

El estado genera como máximo una actualización mensual del repositorio para
evitar que GitHub desactive la tarea programada por inactividad.

## Configuración

1. Crea un repositorio público en GitHub y sube todos estos archivos.
2. Abre `Settings > Secrets and variables > Actions` en el repositorio.
3. Crea el secreto `TELEGRAM_BOT_TOKEN` con el token nuevo de BotFather.
4. Crea el secreto `TELEGRAM_CHAT_ID` con el identificador del grupo.
5. Abre `Actions > Comprobar disponibilidad` y pulsa `Run workflow`.

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
automáticas. En esos casos el estado se conserva y no se genera un falso aviso.
