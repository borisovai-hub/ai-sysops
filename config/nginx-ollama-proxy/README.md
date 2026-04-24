# nginx-ollama-proxy

Буферный nginx, стоящий между клиентами и frpc-туннелями Ollama. Ретраит короткие обрывы
control-канала frpc, скрывая их от потребителей API.

## Схема

```
client  ->  nginx :21434/21435/21436  ->  frpc :11434/11435/11436  ->  tunnel  ->  Ollama (GPU)
            (retries + buffering)        (flaps on reconnect)
```

| Buffered port | Backend (frpc) | Machine   |
|---------------|----------------|-----------|
| 21434         | 11434          | main GPU  |
| 21435         | 11435          | tier1     |
| 21436         | 11436          | tier23    |

## Deploy (на сервере)

```bash
scp ollama-proxy.conf root@borisovai.tech:/etc/nginx-ollama-proxy.conf
docker rm -f ollama-proxy 2>/dev/null
docker run -d --name ollama-proxy --restart unless-stopped --network host \
    -v /etc/nginx-ollama-proxy.conf:/etc/nginx/conf.d/default.conf:ro \
    nginx:alpine
```

## Параметры retry

- `proxy_next_upstream_tries 10` — до 10 попыток
- `proxy_next_upstream_timeout 60s` — суммарно до 60 сек
- Ретрай срабатывает на `error timeout invalid_header http_502 http_503 http_504`

Если frpc возвращается за ≤ 60 сек — клиент видит только увеличенный latency, без ошибки.
