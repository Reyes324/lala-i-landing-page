// POST /.netlify/functions/lead — 官网留资 → 写入飞书多维表格「lala-i 官网留资」
//
// 由 Vercel 上的 lead-api/api/lead.js 迁移而来：vercel.app 域名在国内被阻断，
// 表单提交必失败；挪到官网同一个 Netlify 站点后，页面能打开就能提交。
//
// 需要的环境变量（配在 Netlify → Site configuration → Environment variables）：
//   LEADS_APP_ID       自建应用 App ID（不填则回退用 FEISHU_APP_ID，annotate 那套）
//   LEADS_APP_SECRET   对应的 App Secret（不填则回退用 FEISHU_APP_SECRET）
//   LEADS_BASE_TOKEN   CkT1bBgK3aMwKKsDcNec2mQtnTf
//   LEADS_TABLE_ID     tblCRvuI4cTIzlVQ
//   ALLOWED_ORIGINS    可选，逗号分隔的允许来源，如 https://lala-i.net,https://www.lala-i.net
//                      不填则允许所有来源（*）——页面会被前端同事部署到别的域名，默认放开

const FEISHU_HOST = 'https://open.feishu.cn';
const CONTACT_TYPES = ['手机号', '邮箱', '微信号'];

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getTenantAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 60000) return cachedToken;

  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.LEADS_APP_ID || process.env.FEISHU_APP_ID,
      app_secret: process.env.LEADS_APP_SECRET || process.env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('tenant_access_token failed: ' + JSON.stringify(data));
  cachedToken = data.tenant_access_token;
  cachedTokenExpiry = now + data.expire * 1000;
  return cachedToken;
}

// 尽力而为的限流：同一实例内，单 IP 每分钟最多 5 次
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = 60000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 5;
}

function pickOrigin(event) {
  const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || '';
  if (allow.length === 0) return '*';
  return allow.includes(origin) ? origin : allow[0];
}

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': pickOrigin(event),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (statusCode, body) => ({
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method not allowed' });

  const headers = event.headers || {};
  const ip = String(headers['x-forwarded-for'] || headers['client-ip'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return json(429, { ok: false, error: 'too many requests' });

  try {
    const body = JSON.parse(event.body || '{}');
    const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 100) : '';
    if (!contact) return json(400, { ok: false, error: 'empty contact' });

    const contactType = CONTACT_TYPES.includes(body.contactType) ? body.contactType : '手机号';
    const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : '';
    const channel = typeof body.channel === 'string' ? body.channel.slice(0, 200) : '';

    const token = await getTenantAccessToken();
    const fields = {
      '联系方式': contact,
      '联系方式类型': contactType,
      '提交时间': Date.now(),
      '来源页面': pageUrl ? { link: pageUrl, text: pageUrl } : '',
      '渠道来源': channel,
      '跟进状态': '待跟进',
    };
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${process.env.LEADS_BASE_TOKEN}/tables/${process.env.LEADS_TABLE_ID}/records`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error('create record failed: ' + JSON.stringify(data));
    return json(200, { ok: true });
  } catch (err) {
    console.error('[lead]', err);
    return json(500, { ok: false, error: 'server error' });
  }
};
