import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Server, LogIn, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuthCheck } from '@/api/queries/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { data: auth, isLoading } = useAuthCheck();
  const [error, setError] = useState('');

  // Уже авторизован (Authelia ForwardAuth) → редирект на главную
  if (auth?.authenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const handleAutheliaLogin = () => {
    // На production Authelia перехватывает через Traefik ForwardAuth.
    // Просто перезагружаем — Traefik перенаправит на auth.borisovai.ru/...
    window.location.href = '/';
  };

  const handleTokenLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    const token = String(form.get('token') ?? '').trim();
    if (!token) return;

    try {
      const res = await fetch('/api/auth/check', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // Сохраняем токен и перенаправляем
        localStorage.setItem('auth_token', token);
        window.location.href = '/';
      } else {
        setError('Недействительный токен');
      }
    } catch {
      setError('Ошибка подключения к серверу');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <Server className="h-6 w-6 text-accent" />
          </div>
          <CardTitle>Management UI</CardTitle>
          <CardDescription>Войдите для доступа к панели управления</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Authelia SSO */}
          <Button
            className="w-full"
            onClick={handleAutheliaLogin}
            disabled={isLoading}
          >
            <LogIn className="h-4 w-4" />
            Войти через Authelia SSO
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">или</span>
            </div>
          </div>

          {/* Bearer Token */}
          <form onSubmit={handleTokenLogin} className="space-y-3">
            <Input
              name="token"
              type="password"
              placeholder="Bearer токен"
              autoComplete="off"
            />
            {error && (
              <div className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <Button type="submit" variant="outline" className="w-full">
              Войти по токену
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
