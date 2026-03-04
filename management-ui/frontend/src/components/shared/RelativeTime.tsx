import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface RelativeTimeProps {
  date: string | Date;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    <time className={className} dateTime={d.toISOString()} title={d.toLocaleString('ru-RU')}>
      {formatDistanceToNow(d, { addSuffix: true, locale: ru })}
    </time>
  );
}
