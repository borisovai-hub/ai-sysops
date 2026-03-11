const fs = require('fs');
const path = require('path');

const files = [
  'management-ui/public/index.html',
  'management-ui/public/dns.html',
  'management-ui/public/projects.html',
  'management-ui/public/tunnels.html',
  'management-ui/public/files.html',
  'management-ui/public/ru-proxy.html',
  'management-ui/public/users.html',
  'management-ui/public/content.html',
  'management-ui/public/tokens.html'
];

const analyticsLink = `                <a href="/analytics.html" style="color: #3498db; background: #eaf2f8; text-decoration: none; padding: 8px 16px; border-radius: 4px;">Аналитика</a>`;

let modifiedCount = 0;

files.forEach(file => {
  const fullPath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`❌ Файл не найден: ${file}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  
  // Пропускаем если уже есть ссылка на analytics
  if (content.includes('href="/analytics.html"')) {
    console.log(`⏭️  Уже есть ссылка: ${file}`);
    return;
  }

  // Ищем место после ссылки на projects и вставляем аналитику
  const projectsPattern = /(<a href="\/projects\.html"[^>]*>Проекты<\/a>)/;
  const match = content.match(projectsPattern);
  
  if (!match) {
    console.log(`⚠️  Не найдена ссылка на Проекты: ${file}`);
    return;
  }

  const newContent = content.replace(projectsPattern, `$1\n${analyticsLink}`);
  
  if (newContent === content) {
    console.log(`⚠️  Не удалось изменить: ${file}`);
    return;
  }

  fs.writeFileSync(fullPath, newContent, 'utf-8');
  console.log(`✅ Обновлено: ${file}`);
  modifiedCount++;
});

console.log(`\n📊 Итого: изменено ${modifiedCount} из ${files.length} файлов`);