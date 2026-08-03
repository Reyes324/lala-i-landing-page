// Writes page annotations to a Feishu Bitable table. Write-only (no list/read) —
// annotations are meant to be reviewed inside the Base table itself, not re-rendered on the page.
// Required env vars (set in Netlify project settings, never in client code):
//   FEISHU_APP_ID      - self-built Feishu app id (bot), needs base:record:create
//   FEISHU_APP_SECRET  - matching app secret
//   FEISHU_BASE_TOKEN  - target Base token (from the Base URL)
//   FEISHU_TABLE_ID    - target table id inside that Base

const FEISHU_HOST = 'https://open.feishu.cn';

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

function recordsUrl() {
  const { FEISHU_BASE_TOKEN, FEISHU_TABLE_ID } = process.env;
  return `${FEISHU_HOST}/open-apis/bitable/v1/apps/${FEISHU_BASE_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { section, context, comment, name, url, x, y } = body;
    if (!comment || !section) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing section or comment' }) };
    }

    const token = await getTenantAccessToken();
    const fields = {
      '板块': section,
      '具体位置上下文': context || '',
      '批注内容': comment,
      '留言人': name || '匿名',
      '页面URL': url ? { link: url, text: url } : '',
      '相对X坐标(%)': Number(x) || 0,
      '相对Y坐标(%)': Number(y) || 0,
      '状态': '待处理',
    };
    const res = await fetch(recordsUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error('create record failed: ' + JSON.stringify(data));
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, record_id: data.data.record.record_id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
