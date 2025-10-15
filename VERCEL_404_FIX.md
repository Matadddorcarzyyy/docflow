# VERCEL 404 ОШИБКА - ИСПРАВЛЕНИЕ

## 🚨 Проблема:
Vercel показывает 404 ошибку на `docflow-abja.vercel.app`

## 🔧 РЕШЕНИЕ 1: Простая статика (рекомендуется)

### ШАГ 1: Замените vercel.json
```bash
# Удалите старый vercel.json
del vercel.json

# Переименуйте простой файл
ren vercel-static.json vercel.json
```

### ШАГ 2: Загрузите на GitHub
```bash
git add .
git commit -m "Fix Vercel 404 - use static only"
git push
```

### ШАГ 3: Передеплойте на Vercel
1. Зайдите в настройки проекта Vercel
2. Нажмите "Redeploy" 
3. Или удалите проект и создайте заново

**Результат:** Сайт будет работать как статика без API

---

## 🔧 РЕШЕНИЕ 2: Render.com (полный функционал)

Если нужен API и чаты, используйте Render:

### ШАГ 1: Зайдите на https://render.com
### ШАГ 2: "New" → "Web Service"
### ШАГ 3: Подключите GitHub репозиторий
### ШАГ 4: Настройки:
- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** `Node`

### ШАГ 5: Переменные окружения:
```
NODE_ENV=production
SESSION_SECRET=your_secret_here
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
DATABASE_URL=postgresql://user:pass@host:port/db
```

**Результат:** Полнофункциональный сайт с API

---

## 🔧 РЕШЕНИЕ 3: Netlify (статика) + Railway (API)

### Фронтенд на Netlify:
1. https://netlify.com → "New site from Git"
2. GitHub репозиторий
3. **Publish directory:** `public`
4. **Build command:** `echo "Static site"`

### API на Railway:
1. https://railway.app → "Deploy from GitHub"
2. Выберите репозиторий
3. Root Directory: `server`

---

## 🎯 РЕКОМЕНДАЦИЯ:

**Для быстрого результата:** Используйте **Render.com** - он проще и надежнее Vercel для Node.js приложений.

**Для статики:** Используйте исправленный Vercel с `vercel-static.json`

Какой вариант выберете?
