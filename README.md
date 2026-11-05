# Obsidian em unidade de rede no Claude desktop (Windows)

Como conectar um vault do Obsidian que fica em uma **unidade de rede mapeada** ao Claude desktop usando o servidor MCP `@modelcontextprotocol/server-filesystem`, e como diagnosticar o erro `Connection closed`.

O tutorial nasceu de um caso real. A primeira suspeita era a letra da unidade, mas a causa era outra: o Node.js não estava instalado. O diagnóstico está na ordem certa para evitar esse desvio.

## Resumo

| Sintoma | Causa | Solução |
|---|---|---|
| Status `failed`, erro `Connection closed`, log com `'npx' não é reconhecido` | Node.js não instalado | [Instale o Node.js](#4-instale-o-nodejs) |
| Log com `spawn npx ENOENT` | Falta do Node.js, ou `npx` chamado direto no config | Instale o Node.js e use [`cmd /c npx`](#6-configure-o-servidor) |
| Servidor conecta, mas responde `Access denied - path outside allowed directories` | Sessão do Code/Cowork substituiu as pastas permitidas | [Veja a limitação](#limitação-sessões-do-code-e-do-cowork) |
| `Cannot access directory O:\", skipping` | Aspas depois da barra no teste manual | [Veja as armadilhas](#armadilhas) |

## Requisitos

- Windows com o Claude desktop instalado (o caso real usou a versão da Microsoft Store).
- Unidade de rede acessível pelo seu usuário.
- Acesso de administrador para instalar o Node.js.
- Internet no primeiro uso, porque o `npx` baixa o pacote do servidor.

Nos exemplos, troque `\\SERVIDOR\Obsidian` pelo caminho da sua rede e `O:` pela sua letra.

## Passo a passo

Rode os comandos no PowerShell.

### 1. Encontre o arquivo de configuração

Na versão da Microsoft Store, o arquivo pode não estar em `%APPDATA%\Claude`. No caso real, ele estava aqui:

```text
%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude_desktop_config.json
```

Se não estiver nesse lugar, procure (pode levar alguns segundos):

```powershell
Get-ChildItem "$env:APPDATA","$env:LOCALAPPDATA" -Recurse -Filter claude_desktop_config.json -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
```

Guarde o caminho em uma variável e faça um backup:

```powershell
$cfg = "COLE_AQUI_O_CAMINHO_ENCONTRADO"
Copy-Item $cfg "$cfg.bak"
```

### 2. Leia o log antes de mudar qualquer coisa

`Connection closed` só diz que o processo do servidor terminou. O motivo real está no log:

```powershell
Get-Content "$env:LOCALAPPDATA\Claude\logs\mcp-server-obsidian.log" -Tail 40
```

O nome do arquivo segue o nome do servidor no config (`mcp-server-<nome>.log`). O log geral é o `mcp.log`, na mesma pasta.

A mensagem do Windows pode aparecer com acentos quebrados, por exemplo `'npx' nÆo ‚ reconhecido`. É o mesmo erro de `npx` não reconhecido.

### 3. Descubra o caminho UNC da unidade

```powershell
net use
Test-Path "\\SERVIDOR\Obsidian"
```

O `net use` mostra a letra e o caminho remoto. O `Test-Path` precisa responder `True`.

### 4. Instale o Node.js

Primeiro, verifique se ele já existe:

```powershell
node -v
npx -v
where.exe npx
```

Se os comandos não forem reconhecidos, instale a versão LTS. O Windows vai pedir confirmação de administrador:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --source winget
```

Abra um **novo** PowerShell, para carregar o PATH atualizado, e repita a verificação.

### 5. Teste o servidor fora do Claude

```powershell
npx -y @modelcontextprotocol/server-filesystem "\\SERVIDOR\Obsidian"
```

O resultado esperado é este, e o comando fica aguardando (encerre com `Ctrl+C`):

```text
Secure MCP Filesystem Server running on stdio
Effective allowed directories (from the command line):
  \\SERVIDOR\Obsidian\
```

Para um teste completo, o script [`scripts/testar-mcp.js`](scripts/testar-mcp.js) conversa com o servidor pelo protocolo MCP e lista a pasta:

```powershell
node scripts\testar-mcp.js "\\SERVIDOR\Obsidian"
```

Se funcionar, ele mostra `initialize OK` e o conteúdo do vault na linha `list_directory`.

### 6. Configure o servidor

Feche o Claude desktop pela bandeja antes de editar, porque o app reescreve esse arquivo enquanto está aberto.

Dentro de `mcpServers`, adicione o bloco `obsidian` e não mexa no resto do arquivo. Há um exemplo em [`exemplos/claude_desktop_config.exemplo.json`](exemplos/claude_desktop_config.exemplo.json):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "\\\\SERVIDOR\\Obsidian"
      ]
    }
  }
}
```

Dois detalhes importam:

- **Barras no JSON:** cada `\` vira `\\`, então `\\SERVIDOR\Obsidian` fica `"\\\\SERVIDOR\\Obsidian"`.
- **`cmd /c`:** no Windows o `npx` é um arquivo `npx.cmd`, que normalmente não pode ser iniciado diretamente sem passar pelo `cmd`.

Valide o JSON:

```powershell
Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json | Select-Object -ExpandProperty mcpServers
```

### 7. Reinicie e confirme

1. Reabra o Claude desktop. Se ele estava aberto, feche pela bandeja antes, pois fechar só a janela pode não encerrar o app.
2. Veja se o servidor `obsidian` deixou de aparecer como `failed`.
3. Em uma conversa nova, peça para listar o conteúdo do vault.

## Limitação: sessões do Code e do Cowork

**Conectar não garante acesso ao vault.** O servidor tem duas fontes de pastas permitidas, os argumentos do config e as *Roots* informadas pelo cliente MCP. Quando o cliente informa Roots válidas, elas **substituem** os argumentos.

| Onde o servidor é usado | O que acontece | Como foi verificado |
|---|---|---|
| Sessão do Code com uma pasta aberta | Só a pasta da sessão fica permitida; o vault dá `Access denied` | Testado com chamadas reais, por UNC e por letra |
| Conexão principal do app | O vault continua permitido | Só pelo log (`Client does not support MCP Roots, using allowed directories set from server args`) |
| Sessão que não informa Roots válidas | O vault continua permitido | Só pelo log (`No valid root directories provided by client`) |

No log, a substituição aparece assim:

```text
Effective allowed directories (from the client's Roots, which replaced the command-line directories):
  C:\caminho\da\pasta-da-sessao
```

Para conferir numa sessão, chame a ferramenta `list_allowed_directories` do próprio servidor.

**Possível contorno, não testado:** abrir a sessão na própria pasta do vault, para que ela seja a Root informada.

## Armadilhas

- **A letra da unidade não era o problema neste caso.** Depois de instalar o Node.js, `O:\` e o caminho UNC funcionaram no teste do passo 5, iniciado de um shell aberto pelo próprio app. Mesmo assim, prefira o UNC: unidades mapeadas valem por sessão de usuário, e um processo em outro contexto (como administrador ou outro usuário) pode não enxergar a letra.
- **Aspas com barra final.** `"O:\"` não funciona na linha de comando, porque `\"` vira uma aspa literal e o servidor recebe `O:\"`. Use `O:\` sem aspas ou o caminho UNC.
- **Teste em PowerShell.** Um teste do protocolo feito à mão em PowerShell expirou sem resposta no caso real, enquanto o mesmo servidor respondeu ao script em Node. A causa não foi investigada, então prefira o script deste repositório.
- **`Connection closed` é genérico.** Outros servidores podem mostrar o mesmo erro por outros motivos. Um servidor acessado por `mcp-proxy` em uma porta local, por exemplo, falha com `httpx.ConnectError: All connection attempts failed` se o programa que abre a porta estiver fechado. O remédio é sempre começar pelo `mcp-server-<nome>.log`.

## Segurança

O `server-filesystem` não é somente leitura. Ele oferece ferramentas como `write_file`, `edit_file` e `move_file`, então o Claude pode alterar as notas dentro das pastas permitidas. Mantenha um backup ou histórico de versões do vault.

Se a sua cópia deste tutorial for pública, tire do config e dos logs o que for interno antes de colar: IPs, nomes de usuário e os blocos de preferências e identificadores de conta do `claude_desktop_config.json`.

## Como desfazer

Com o Claude desktop fechado, restaure o backup (ele também volta as preferências salvas pelo app desde que foi criado):

```powershell
Copy-Item "$cfg.bak" $cfg -Force
```

## Ambiente testado

Em 5 de novembro de 2026:

| Item | Versão |
|---|---|
| Sistema | Windows 11 Pro 10.0.26300 |
| Claude desktop | Microsoft Store |
| Node.js | 26.13.0 |
| npx | 11.20.0 |
| `secure-filesystem-server` | 2.2.0 |

Os caminhos e o comportamento do app podem mudar em outras versões.
