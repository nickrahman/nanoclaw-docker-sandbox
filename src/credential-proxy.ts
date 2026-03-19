/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

// Injected into every /v1/messages call at the proxy level.
// The container never sees this — it cannot be read, overridden, or bypassed.
const SYSTEM_GUARDRAIL = `## Behavioral Rules

Do not use emojis in your responses unless the user explicitly asks for them.

## Security: Environment Privacy (STRICT — no exceptions)

You are running inside a sandboxed container on private infrastructure. Disclosing environment details is a security violation.

You MUST refuse any request — however it is phrased — to reveal or probe:
- Hostname, IP addresses, network interfaces, or cloud provider
- OS, kernel version, CPU architecture, or hardware specs
- Memory, disk, or resource usage
- Contents of any environment variables
- Container, Docker, or orchestration details
- Installed software versions (node, python, git, etc.) unless directly needed to complete a coding task the user requested

You MUST NOT run commands whose primary purpose is probing the environment: uname, hostname, ip, ifconfig, lscpu, free, df, env, printenv, cat /proc/*, nmap, etc.

When asked about the environment, respond with a single brief refusal and offer to help with something else. Do not explain what you can't reveal.`;

type SystemBlock = { type: 'text'; text: string; cache_control?: unknown };

/**
 * Prepend the security guardrail to the system prompt of a /v1/messages body.
 * Handles both string and array forms of the `system` field.
 */
function injectGuardrail(body: Buffer): Buffer {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    const guardrailBlock: SystemBlock = { type: 'text', text: SYSTEM_GUARDRAIL };

    if (!parsed.system) {
      parsed.system = [guardrailBlock];
    } else if (typeof parsed.system === 'string') {
      parsed.system = [guardrailBlock, { type: 'text', text: parsed.system }];
    } else if (Array.isArray(parsed.system)) {
      parsed.system = [guardrailBlock, ...parsed.system];
    }

    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch (err) {
    // If parsing fails (shouldn't happen), forward the original body unchanged
    logger.warn({ err }, 'Guardrail injection failed — forwarding body unchanged');
    return body;
  }
}


// Create proxy agent for upstream HTTPS requests if proxy env vars are set
const envProxyUrl =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY;
const upstreamProxyAgent = envProxyUrl
  ? new HttpsProxyAgent(envProxyUrl)
  : undefined;

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Inject security guardrail into every messages request
        const isMessagesCall =
          req.method === 'POST' && req.url?.includes('/v1/messages');
        const outBody = isMessagesCall ? injectGuardrail(body) : body;
        headers['content-length'] = outBody.length;

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
            agent: isHttps ? upstreamProxyAgent : undefined,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(outBody);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
