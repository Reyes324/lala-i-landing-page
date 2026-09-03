// POST /api/lead — 官网留资 → 写入飞书多维表格「lala-i 官网留资」
//
// 这是一个独立的 Vercel Serverless Function，不属于官网静态站。
// 官网前端只把表单 fetch 指到这个函数的地址，其余全在这里处理。
//
// 需要的环境变量（配在 Vercel 项目 Settings → Environment Variables）：
//   FEISHU_APP_ID      自建应用 App ID
//   FEISHU_APP_SECRET  自建应用 App Secret
//   LEADS_BASE_TOKEN   CkT1bBgK3aMwKKsDcNec2mQtnTf
//   LEADS_TABLE_ID     tblCRvuI4cTIzlVQ
//   ALLOWED_ORIGINS    可选，逗号分隔的允许来源，如 https://lala-i.net,https://www.lala-i.net
//                      不填则允许所有来源（*）

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
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
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

function pickOrigin(req) {
  const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (allow.length === 0) return '*';
  return allow.includes(origin) ? origin : allow[0];
}

export default async function handler(req, res) {
  const origin = pickOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'too many requests' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    if (!contact || contact.length < 3 || contact.length > 100) {
      return res.status(400).json({ ok: false, error: 'invalid contact' });
    }
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
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[lead]', err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
}
