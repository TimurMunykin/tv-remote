# CLAUDE.md

## Правила разработки

### Docker — единственный способ запуска
- Всё работает через Docker. На сервере `192.168.31.36` ничего не устанавливается локально.
- Не предлагать и не выполнять `apt install`, `pip install`, `npm install` и т.д. на сервере напрямую.
- Зависимости добавляются только через `requirements.txt` и `Dockerfile`.

### Деплой — только через rebuild.sh
- После любых изменений пересборка и деплой выполняются **только** командой `./rebuild.sh`.
- Никогда не запускать `docker compose up --build` или `docker restart` напрямую.

## Инфраструктура

| Что | Где |
|-----|-----|
| Сервер | `192.168.31.36` |
| Телевизор | `192.168.31.194` (Philips 55OLED706/12) |
| Веб-интерфейс | `http://192.168.31.36:8099` |
| Репозиторий | `git@github.com:TimurMunykin/tv-remote.git` |

## TV API

- Philips JointSpace API: `https://192.168.31.194:1926/6/...` с Digest Auth
- Credentials: user=`claude01`, password=`2ace7b0ad9884c8dce777c6e7f5dcfd6ddfcb6bb10223037b9d56c8f8402564d`
- ADB: `192.168.31.194:5555` (ключи лежат в `adb-keys/`, монтируются в контейнер)
