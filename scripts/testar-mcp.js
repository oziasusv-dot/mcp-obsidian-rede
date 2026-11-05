// Testa o server-filesystem pelo protocolo MCP, iniciando-o como o config faz (cmd /c npx ...).
// O npx baixa o pacote @modelcontextprotocol/server-filesystem se ele nao estiver em cache.
//
// Uso (Windows): node testar-mcp.js "\\192.168.x.x\Obsidian" [outro caminho ...]
// Troque 192.168.x.x pelo IP real do servidor (ou pelo nome dele).
const { spawn, execSync } = require('child_process');

const TIMEOUT_MS = 60000;

function run(root) {
  return new Promise((resolve) => {
    console.log(`\n=== ${root} ===`);
    const t0 = Date.now();
    const p = spawn('cmd', ['/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem', root], {
      stdio: 'pipe',
      windowsHide: true,
    });
    let buf = '';
    let stderr = '';
    const waiting = new Map();

    p.stderr.on('data', (d) => (stderr += d));
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (waiting.has(m.id)) {
            waiting.get(m.id)(m);
            waiting.delete(m.id);
          } else {
            console.log('(nao solicitado)', line.slice(0, 200));
          }
        } catch {
          console.log('(stdout nao JSON)', line.slice(0, 200));
        }
      }
    });

    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    const call = (id, method, params) =>
      new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error(`timeout em ${method}`)), TIMEOUT_MS);
        waiting.set(id, (m) => {
          clearTimeout(to);
          res(m);
        });
        send({ jsonrpc: '2.0', id, method, params });
      });
    const short = (o) => {
      const s = JSON.stringify(o);
      return s.length > 500 ? s.slice(0, 500) + ' ...' : s;
    };
    const finish = () => {
      try {
        execSync(`taskkill /T /F /PID ${p.pid}`, { stdio: 'ignore' });
      } catch {}
      console.log('--- stderr ---');
      console.log(stderr.split('\n').filter((l) => !/npm notice/.test(l)).join('\n').trim());
      resolve();
    };

    p.on('error', (e) => console.log('Falha ao iniciar:', e.message));

    (async () => {
      try {
        const init = await call(1, 'initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'testar-mcp', version: '1' },
        });
        console.log(`initialize OK em ${Date.now() - t0} ms:`, short(init.result.serverInfo));
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const allowed = await call(2, 'tools/call', { name: 'list_allowed_directories', arguments: {} });
        console.log('allowed:', short(allowed.result));
        const list = await call(3, 'tools/call', { name: 'list_directory', arguments: { path: root } });
        console.log('list_directory:', short(list.result));
      } catch (e) {
        console.log('FALHA:', e.message);
        process.exitCode = 1;
      }
      finish();
    })();
  });
}

(async () => {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error('Uso: node testar-mcp.js "\\\\192.168.x.x\\Obsidian" [outro caminho ...]');
    process.exit(2);
  }
  for (const r of roots) await run(r);
})();
