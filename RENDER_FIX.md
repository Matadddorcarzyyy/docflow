# RENDER.COM ОШИБКА - ИСПРАВЛЕНИЕ

## 🚨 Проблема:
```
Error: Cannot find module '/opt/render/project/src/server/dist/index.js'
```

## ✅ РЕШЕНИЕ:

Я исправил `server/package.json` - теперь он ищет файл в правильном месте.

---

## 🚀 ИНСТРУКЦИЯ ДЛЯ RENDER:

### ШАГ 1: Загрузите исправленные файлы
```bash
git add .
git commit -m "Fix Render deployment - correct file paths"
git push
```

### ШАГ 2: Настройка на Render.com
1. **Зайдите на https://render.com**
2. **"New" → "Web Service"**
3. **Подключите GitHub репозиторий**
4. **Настройки проекта:**
   - **Name:** `docflow-api`
   - **Root Directory:** `server` ← ВАЖНО!
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`

### ШАГ 3: Переменные окружения
В настройках проекта добавьте:

```
NODE_ENV=production
SESSION_SECRET=your_very_long_random_secret_key_here
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
ADMIN_FULL_NAME=Site Administrator
ALLOWED_ORIGINS=https://your-app.onrender.com
PORT=8080
```

### ШАГ 4: База данных
1. **В Render Dashboard** → "New" → "PostgreSQL"
2. **Создайте базу данных**
3. **Скопируйте connection string**
4. **Добавьте в переменные:**
   ```
   DATABASE_URL=postgresql://user:pass@host:port/dbname
   ```

---

## 🔧 АЛЬТЕРНАТИВНЫЕ НАСТРОЙКИ:

### Если все еще не работает, попробуйте:

**Build Command:** `echo "No build needed"`
**Start Command:** `node src/index.js`

### Или создайте Procfile в папке server:
```
web: node src/index.js
```

---

## 📁 СТРУКТУРА ПРОЕКТА (должна быть):
```
SITE/
├── server/
│   ├── src/
│   │   └── index.js        ← Главный файл
│   ├── package.json        ← Исправлен
│   └── ...
├── public/                 ← Статика
├── render.yaml            ← Конфигурация Render
└── ...
```

---

## 🎯 ПРОВЕРКА:

После деплоя проверьте:
- ✅ API: `https://your-app.onrender.com/api/health`
- ✅ Главная: `https://your-app.onrender.com` (если настроен статический хостинг)

---

## 🆘 ЕСЛИ ВСЕ ЕЩЕ НЕ РАБОТАЕТ:

### Вариант A: Railway (проще)
1. https://railway.app
2. "Deploy from GitHub"
3. Автоматически определит Node.js

### Вариант B: Heroku
1. Установите Heroku CLI
2. `heroku create your-app`
3. `git push heroku main`

### Вариант C: Только статика на Netlify
1. https://netlify.com
2. Publish directory: `public`
3. Без API, только HTML страницы

---

## 📞 ПОДДЕРЖКА:
- Render Discord: https://discord.gg/render
- Документация: https://render.com/docs
