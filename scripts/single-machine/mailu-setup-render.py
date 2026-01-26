#!/usr/bin/env python3
# Рендер официальных шаблонов Mailu (setup/flavors/compose) в docker-compose.yml и mailu.env.
# Использование: mailu-setup-render.py --domain <domain> --hostnames <hostnames> [--root /opt/mailu] ...

from __future__ import annotations

import argparse
import os
import secrets
import sys
import urllib.request

try:
    import jinja2
except ImportError:
    print("Ошибка: установите jinja2 (apt install python3-jinja2 или pip install jinja2)", file=sys.stderr)
    sys.exit(1)

MAILU_SETUP_BASE = "https://raw.githubusercontent.com/Mailu/Mailu/master/setup/flavors/compose"
COMPOSE_URL = f"{MAILU_SETUP_BASE}/docker-compose.yml"
ENV_URL = f"{MAILU_SETUP_BASE}/mailu.env"


def secret(n: int) -> str:
    return secrets.token_hex(n)


def main() -> None:
    ap = argparse.ArgumentParser(description="Render Mailu compose + env from official templates")
    ap.add_argument("--domain", required=True, help="Main mail domain (e.g. example.com)")
    ap.add_argument("--hostnames", required=True, help="Comma-separated hostnames (e.g. mail.example.com)")
    ap.add_argument("--postmaster", default="admin", help="Postmaster local part")
    ap.add_argument("--root", default="/opt/mailu", help="Mailu data root")
    ap.add_argument("--tls-flavor", default="mail-letsencrypt", choices=("letsencrypt", "mail-letsencrypt", "cert", "notls"))
    ap.add_argument("--http-port", type=int, default=6555, help="HTTP port for front (admin/webmail)")
    ap.add_argument("--https-port", type=int, default=6554, help="HTTPS port for front (admin/webmail)")
    ap.add_argument("--initial-admin-account", default="admin", help="Admin username (local part)")
    ap.add_argument("--initial-admin-password", default="", help="Admin password (empty = generate random)")
    ap.add_argument("--templates-dir", default="", help="Dir with docker-compose.yml + mailu.env templates (else fetch)")
    args = ap.parse_args()

    root = args.root.rstrip("/")
    domain = args.domain.strip()
    hostnames = args.hostnames.strip()
    postmaster = args.postmaster.strip() or "admin"
    tls_flavor = args.tls_flavor
    http_port = args.http_port
    https_port = args.https_port
    initial_account = (args.initial_admin_account or "admin").strip()
    initial_password = args.initial_admin_password
    if not initial_password:
        initial_password = secrets.token_urlsafe(12)
        password_generated = True
    else:
        password_generated = False

    if args.templates_dir:
        td = os.path.abspath(args.templates_dir)
        compose_path = os.path.join(td, "docker-compose.yml")
        env_path = os.path.join(td, "mailu.env")
        if not os.path.isfile(compose_path) or not os.path.isfile(env_path):
            print(f"Ошибка: в {td} должны быть docker-compose.yml и mailu.env", file=sys.stderr)
            sys.exit(1)
        with open(compose_path, "r", encoding="utf-8") as f:
            compose_tpl = f.read()
        with open(env_path, "r", encoding="utf-8") as f:
            env_tpl = f.read()
    else:
        for url, name in ((COMPOSE_URL, "docker-compose.yml"), (ENV_URL, "mailu.env")):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    data = r.read().decode("utf-8")
            except Exception as e:
                print(f"Ошибка загрузки {name}: {e}", file=sys.stderr)
                sys.exit(1)
            if name == "docker-compose.yml":
                compose_tpl = data
            else:
                env_tpl = data

    flavor = "compose"
    resolver_enabled = False
    bind4 = "0.0.0.0"
    bind6 = "::"
    ipv6_enabled = True
    version = "2.0"
    webmail_type = "roundcube"
    webdav_enabled = False
    admin_enabled = True
    tika_enabled = False
    oletools_enabled = False
    antivirus_enabled = False
    fetchmail_enabled = False
    subnet = "192.168.203.0/24"
    subnet6 = "fd4d:6169:6c63:6f77::/64"
    dns = "192.168.203.254"

    compose_ctx = {
        "env": "mailu.env",
        "flavor": flavor,
        "root": root,
        "resolver_enabled": resolver_enabled,
        "dns": dns,
        "bind4": bind4,
        "bind6": bind6,
        "ipv6_enabled": ipv6_enabled,
        "version": version,
        "webmail_type": webmail_type,
        "webdav_enabled": webdav_enabled,
        "admin_enabled": admin_enabled,
        "tika_enabled": tika_enabled,
        "oletools_enabled": oletools_enabled,
        "antivirus_enabled": antivirus_enabled,
        "fetchmail_enabled": fetchmail_enabled,
        "subnet": subnet,
        "subnet6": subnet6,
    }

    env_ctx = {
        "flavor": flavor,
        "subnet": subnet,
        "ipv6_enabled": ipv6_enabled,
        "subnet6": subnet6,
        "domain": domain,
        "hostnames": hostnames,
        "postmaster": postmaster,
        "tls_flavor": tls_flavor,
        "auth_ratelimit_ip": "5",
        "auth_ratelimit_user": "50",
        "statistics_enabled": False,
        "admin_enabled": admin_enabled,
        "webmail_type": webmail_type,
        "api_enabled": False,
        "webdav_enabled": webdav_enabled,
        "antivirus_enabled": antivirus_enabled,
        "oletools_enabled": oletools_enabled,
        "message_size_limit": "50000000",
        "message_ratelimit_pd": "0",
        "relayhost": "",
        "fetchmail_enabled": fetchmail_enabled,
        "fetchmail_delay": "600",
        "recipient_delimiter": "+",
        "dmarc_rua": postmaster,
        "dmarc_ruf": postmaster,
        "welcome_enable": "false",
        "welcome_subject": "Welcome to your new email account",
        "welcome_body": "Welcome!",
        "compression": "none",
        "compression_level": "6",
        "site_name": "Mailu",
        "website": "",
        "recaptcha_public_key": "",
        "recaptcha_private_key": "",
        "domain_registration": False,
        "compose_project_name": "mailu",
        "real_ip_header": "X-Forwarded-For",
        "real_ip_from": "127.0.0.1/32",
        "reject_unlisted_recipient": "no",
        "api_token": secrets.token_hex(16),
        "tika_enabled": tika_enabled,
    }

    def secret_filter(n: int) -> str:
        return secrets.token_hex(n)

    env = jinja2.Environment(
        variable_start_string="{{",
        variable_end_string="}}",
        block_start_string="{%",
        block_end_string="%}",
    )
    env.globals["secret"] = secret_filter

    try:
        comp = env.from_string(compose_tpl)
        out_compose = comp.render(**compose_ctx)
    except Exception as e:
        print(f"Ошибка рендера docker-compose: {e}", file=sys.stderr)
        sys.exit(1)

    # Админка и webmail (front): только 80/443 на 127.0.0.1:6555, 127.0.0.1:6554
    for a, b in [
        ('"0.0.0.0:80:80"', f'"127.0.0.1:{http_port}:80"'),
        ('"[::]:80:80"', f'"[::1]:{http_port}:80"'),
        ('"0.0.0.0:443:443"', f'"127.0.0.1:{https_port}:443"'),
        ('"[::]:443:443"', f'"[::1]:{https_port}:443"'),
    ]:
        out_compose = out_compose.replace(a, b)

    try:
        envt = env.from_string(env_tpl)
        out_env = envt.render(**env_ctx)
    except Exception as e:
        print(f"Ошибка рендера mailu.env: {e}", file=sys.stderr)
        sys.exit(1)

    # Автосоздание админа при первом старте (документация Mailu)
    out_env += "\n# Admin account - automatic creation (https://mailu.io/master/configuration.html)\n"
    out_env += f"INITIAL_ADMIN_ACCOUNT={initial_account}\n"
    out_env += f"INITIAL_ADMIN_DOMAIN={domain}\n"
    out_env += f"INITIAL_ADMIN_PASSWORD={initial_password}\n"

    os.makedirs(root, exist_ok=True)
    compose_out = os.path.join(root, "docker-compose.yml")
    env_out = os.path.join(root, "mailu.env")
    with open(compose_out, "w", encoding="utf-8") as f:
        f.write(out_compose)
    with open(env_out, "w", encoding="utf-8") as f:
        f.write(out_env)
    print(f"Записано: {compose_out}, {env_out}")
    if password_generated:
        print(f"Пароль админа ({initial_account}@{domain}): {initial_password}")


if __name__ == "__main__":
    main()
