# Inicializacao automatica no Windows

Use estes scripts quando o bot for rodar no PC do cliente.

## Instalar

1. Instale o Node.js LTS no Windows.
2. Abra a pasta do bot.
3. Execute `scripts/windows/install-startup-task.bat`.
4. Se o Windows pedir permissao de firewall para o Node.js, clique em **Permitir acesso**.

Depois disso, quando o Windows entrar na conta do usuario, o servidor do bot inicia sozinho.

## URL no aplicativo

No mesmo Wi-Fi, configure o aplicativo com o IP do PC:

```txt
http://IP-DO-PC:3000
```

Exemplo:

```txt
http://192.168.3.200:3000
```

## Logs

Os logs ficam em:

```txt
logs/bot-api.log
logs/bot-api-startup.log
```

## Remover

Execute:

```txt
scripts/windows/uninstall-startup-task.bat
```
