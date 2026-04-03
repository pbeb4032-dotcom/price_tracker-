import 'dotenv/config';
import net from 'node:net';
import { Client } from 'pg';

function needEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    protocol: u.protocol,
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, ''),
    username: decodeURIComponent(u.username || ''),
    hasPassword: Boolean(u.password),
    ssl: ['require', 'verify-ca', 'verify-full'].includes((u.searchParams.get('sslmode') || '').toLowerCase()),
  };
}

async function tcpProbe(host: string, port: number, timeoutMs = 3000) {
  return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (payload: { ok: boolean; error?: string }) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(payload);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }));
    socket.once('error', (err) => finish({ ok: false, error: err.message }));
    socket.connect(port, host);
  });
}

async function pgProbe(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const r = await client.query(`select current_database() as database, current_user as username, version() as version`);
    return { ok: true, row: r.rows[0] } as const;
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) } as const;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const databaseUrl = needEnv('DATABASE_URL');
  const parsed = parseDatabaseUrl(databaseUrl);
  const tcp = await tcpProbe(parsed.host, parsed.port);
  const pg = tcp.ok ? await pgProbe(databaseUrl) : { ok: false, error: 'pg probe skipped because tcp probe failed' };

  const summary = {
    ok: Boolean(tcp.ok && pg.ok),
    database_url: {
      protocol: parsed.protocol,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      username: parsed.username,
      hasPassword: parsed.hasPassword,
      ssl: parsed.ssl,
    },
    tcp,
    pg,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error('db preflight failed');
  console.error(err?.stack || String(err));
  process.exit(1);
});
