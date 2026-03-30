# TV Remote

Веб-пульт для Philips 55OLED706/12 (Android TV).

## Стек

- **Backend**: Python / Flask / Gunicorn
- **Протоколы**: Philips JointSpace API (HTTPS + Digest Auth), ADB
- **Деплой**: Docker на сервере `192.168.31.36:8099`

## Правила

- **Всё работает через Docker.** Локально на сервере ничего не устанавливается.
- **Любые изменения деплоятся только через `rebuild.sh`** — не через `docker compose` напрямую.

## Деплой

```bash
./rebuild.sh
```

Скрипт сам определяет что изменилось:
- только `static/` → rsync + `docker restart` (быстро)
- всё остальное → rsync + `docker compose up -d --build`

## Доступ к интерфейсу

```
http://192.168.31.36:8099
```

## Возможности

- Включение/выключение телевизора (WoL + Philips API)
- Навигация (d-pad, OK, Back, Home)
- Громкость и мут
- Медиа-кнопки (play/pause/stop/ff/rewind)
- Запуск приложений (YouTube, Netflix и др.)
- Скриншот экрана через ADB с галереей и лайтбоксом
