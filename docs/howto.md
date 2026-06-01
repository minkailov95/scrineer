# Как работать со Scrineer — справочник

## Как ко мне обращаться

### Начать новую тему
```
продолжай. нужно сделать [задача]
→ я читаю docs/next.md + docs/bugs.md + docs/architecture.md
→ начинаю с чистого контекста
```

### Продолжить после перерыва
```
продолжаем. задача из docs/next.md: [название пункта]
→ я читаю docs/*.md, вижу где остановились
→ продолжаю
```

### Сохранить прогресс (перед перерывом)
```
сохрани сессию
→ обновляю docs/next.md (галочки у сделанного)
→ обновляю session_history.md
→ коммит + push в GitHub
```

### Если я забыл контекст
```
прочитай docs/architecture.md и docs/next.md
→ я перечитываю файлы и восстанавливаю контекст
```

## Где что лежит

| Файл | Что там |
|---|---|
| `docs/architecture.md` | стек, структура проекта, почему такие решения |
| `docs/next.md` | что делать дальше (чеки-лист) |
| `docs/bugs.md` | открытые баги |
| `docs/system.md` | старая документация V1 (для справки) |
| `session_history.md` | история всех сессий |

## Проекты

### V2 (текущий)
```
URL:    http://176.97.70.161:5000/
Сервер: tmux session "scrineer" на порту 5000
Сборка: cd /root/scrineer/v2 && npx vite build
Код:    /root/scrineer/v2/src/
```

### V1 (старый)
```
Код:    /root/scrineer/index.html (монолит)
Запуск: server.py → os.chdir("/root/scrineer") вместо v2/dist
```

## Команды для сервера

```bash
# Проверить что сервер жив
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/

# Перезапустить сервер через tmux
tmux send-keys -t scrineer C-c Enter 'cd /root/scrineer && python3 server.py' Enter

# Посмотреть логи сервера
tmux capture-pane -t scrineer -p | tail -20

# Собрать V2
cd /root/scrineer/v2 && npx vite build
```

## Что я всегда помню (даже после "сохрани сессию")
- URL проекта: http://176.97.70.161:5000/
- GitHub: https://github.com/minkailov95/scrineer
- Логин wintrading: minkailov.95@gmail.com / wAMATAWAMATA1212!
