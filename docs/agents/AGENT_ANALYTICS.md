# Инструкция для агента: Интеграция Umami Analytics

## Назначение

Добавить скрипт веб-аналитики Umami в Next.js проект для отслеживания посещаемости сайта.

## Получение website ID

1. Зайти в Management UI → Аналитика (https://admin.borisovai.ru/analytics.html)
2. Или напрямую в Umami dashboard (https://analytics.dev.borisovai.ru)
3. Войти под admin пользователем (создаётся при первом запуске Umami)
4. Перейти в **Settings → Websites**
5. Нажать **Add website**
   - Name: название сайта (например, "Borisovai Site")
   - Domain: домен сайта (например, "borisovai.ru")
6. Скопировать **Website ID** (UUID формат)

## Интеграция в Next.js

### App Router (рекомендуется)

В `app/layout.tsx` (или `app/[locale]/layout.tsx` для i18n проектов):

```tsx
import Script from 'next/script';

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <Script
          src="https://analytics.dev.borisovai.ru/stats.js"
          data-website-id="ВСТАВЬТЕ_WEBSITE_ID_СЮДА"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### Pages Router (устаревший)

В `pages/_app.tsx`:

```tsx
import Script from 'next/script';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script
        src="https://analytics.dev.borisovai.ru/stats.js"
        data-website-id="ВСТАВЬТЕ_WEBSITE_ID_СЮДА"
        strategy="afterInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}
```

**Параметры:**
- `src` — адрес скрипта Umami (всегда `https://analytics.dev.borisovai.ru/stats.js`)
- `data-website-id` — UUID website из Umami dashboard
- `strategy="afterInteractive"` — загрузка после интерактивности (не блокирует рендеринг)

## Кастомные события (опционально)

Для отслеживания пользовательских действий (клики, скачивания, отправка форм):

```typescript
'use client'; // Только для клиентских компонентов

declare global {
  interface Window {
    umami?: {
      track: (eventName: string, eventData?: Record<string, any>) => void;
    };
  }
}

// Отслеживание клика по проекту
function trackProjectView(slug: string) {
  if (typeof window !== 'undefined' && window.umami) {
    window.umami.track('project-view', { slug });
  }
}

// Отслеживание скачивания файла
function trackDownload(file: string, version: string) {
  if (typeof window !== 'undefined' && window.umami) {
    window.umami.track('download', { file, version });
  }
}

// Отслеживание клика по внешней ссылке
function trackExternalLink(url: string) {
  if (typeof window !== 'undefined' && window.umami) {
    window.umami.track('external-link', { url });
  }
}

// Пример использования в компоненте
export function ProjectCard({ project }) {
  const handleClick = () => {
    trackProjectView(project.slug);
  };

  return (
    <div onClick={handleClick}>
      <h3>{project.title}</h3>
    </div>
  );
}
```

**Важно:** Проверяй наличие `window.umami` перед вызовом, чтобы избежать ошибок на SSR.

## Проверка работы

1. Открыть сайт в браузере (production или dev mode)
2. Открыть DevTools → Network
3. Найти запрос к `/stats.js` (должен загрузиться успешно)
4. Найти запрос к `/api/send` (события отправляются в Umami)
5. Зайти в Umami Dashboard → Website → Realtime
6. Проверить, что текущий визит отображается в реальном времени

**Если скрипт не загружается:**
- Проверить доступность https://analytics.dev.borisovai.ru/stats.js (откройте напрямую в браузере)
- Проверить website ID (должен быть валидным UUID)
- Проверить Console в DevTools на наличие ошибок

## Особенности

- **Без cookies** — Umami использует fingerprinting (IP + User-Agent), GDPR-compliant
- **Не требует consent banner** — не собирает персональные данные
- **Async загрузка** — не блокирует рендеринг страницы (~2 KB скрипт)
- **AdBlock bypass** — скрипт называется `stats.js` вместо типичных `analytics.js` или `tracking.js`
- **Батчинг событий** — не отправляется на каждое действие, оптимизировано для производительности

## Дополнительные материалы

- **Документация Umami**: https://umami.is/docs
- **Tracking Events API**: https://umami.is/docs/tracking-events
- **React Integration**: https://umami.is/docs/guides/react
- **Umami Dashboard**: https://analytics.dev.borisovai.ru

## Пример полной интеграции (borisovai-site)

```tsx
// app/[locale]/layout.tsx
import Script from 'next/script';
import { getDictionary } from '@/lib/dictionaries';

export default async function LocaleLayout({
  children,
  params: { locale }
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const dict = await getDictionary(locale);

  return (
    <html lang={locale}>
      <head>
        {/* Umami Analytics */}
        <Script
          src="https://analytics.dev.borisovai.ru/stats.js"
          data-website-id="12345678-1234-1234-1234-123456789012"
          strategy="afterInteractive"
        />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

## Устранение проблем

| Проблема | Решение |
|----------|---------|
| Скрипт не загружается | Проверить доступность `https://analytics.dev.borisovai.ru` (DNS, Traefik, контейнер) |
| События не отправляются | Проверить website ID, проверить `/api/send` endpoint в DevTools |
| Дублирование событий | Убедиться, что скрипт добавлен только в корневой layout (не в каждом page) |
| Ошибка SSR | Обернуть вызовы `window.umami` в `typeof window !== 'undefined'` |

## Важные замечания

- **Один website ID на домен** — для поддоменов создавайте отдельные websites
- **Локальная разработка** — события будут отправляться в Umami даже с localhost (фильтруйте в dashboard)
- **Версионирование** — при обновлении сайта website ID остаётся тем же (исторические данные сохраняются)
