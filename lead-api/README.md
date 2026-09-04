# lala-i 官网留资接收函数（⚠️ 已停用，仅作存档）

> **2026-09-04：这套 Vercel 版本已不再使用。**
> `*.vercel.app` 域名在中国大陆被阻断，用户不挂 VPN 时表单提交必然失败。
> 现行实现是 `netlify/functions/lead.js`，逻辑相同，托管在官网同一个 Netlify 站点。
> 完整链路说明、环境变量、部署与验证方法见根目录 **`留资链路与部署.md`**。
> 本目录暂时保留作对照，确认新版稳定后可删除并在 Vercel 后台下线项目。

独立的 Vercel Serverless Function。**不属于官网静态站**，单独部署。
收到官网留资表单的提交 → 写入飞书多维表格「lala-i 官网留资」。

- 多维表格：https://huolala.feishu.cn/base/CkT1bBgK3aMwKKsDcNec2mQtnTf
- `app_token`：`CkT1bBgK3aMwKKsDcNec2mQtnTf`
- `table_id`：`tblCRvuI4cTIzlVQ`

## 一次性准备（飞书侧）

1. 有一个飞书**自建应用**（企业内部应用），拿到 `App ID` / `App Secret`
2. 该应用开通权限：`bitable:app`（多维表格读写）
3. 打开上面那张多维表格 → 右上角 `···` → 添加文档应用 / 协作者 → 把这个应用加进来，给**可编辑**权限

## 部署（Vercel）

```
cd lead-api
npx vercel            # 首次会引导登录 + 创建项目
npx vercel --prod     # 部署到生产
```

或在 vercel.com 新建项目，Root Directory 指到 `lead-api/`。

### 环境变量（Vercel → Settings → Environment Variables）

| 变量 | 值 |
|---|---|
| `FEISHU_APP_ID` | 自建应用 App ID |
| `FEISHU_APP_SECRET` | 自建应用 App Secret |
| `LEADS_BASE_TOKEN` | `CkT1bBgK3aMwKKsDcNec2mQtnTf` |
| `LEADS_TABLE_ID` | `tblCRvuI4cTIzlVQ` |
| `ALLOWED_ORIGINS` | 可选。官网正式域名，逗号分隔，如 `https://lala-i.net,https://www.lala-i.net`。不填=允许所有来源 |

改完环境变量要 redeploy 一次才生效。

## 已部署

- Vercel 项目：`qiuweijiameiguo123-7183s-projects/lead-api`
- 生产地址（固定别名）：**https://lead-api-six.vercel.app/api/lead**
- 4 个环境变量已在 Production 配好（App 复用 `cli_a940e9e9bbb99bd2`，已拥有该表权限，无需加协作者）
- `index.html` 里 `const LEAD_API` 已指向该地址

改环境变量后需 `vercel --prod` 重新部署一次才生效。

## 联调自测

```
curl -X POST https://<项目名>.vercel.app/api/lead \
  -H 'Content-Type: application/json' \
  -d '{"contact":"13800138000","contactType":"手机号","pageUrl":"https://lala-i.net/","channel":"test"}'
# 期望 {"ok":true}，并在多维表格里看到新行（记得删掉测试行）
```

## 接口契约

`POST /api/lead`，请求体：

```json
{
  "contact": "13800138000",
  "contactType": "手机号",
  "pageUrl": "https://lala-i.net/",
  "channel": "utm_source=xxx"
}
```

- `contactType`：`手机号` | `邮箱` | `微信号`，非法值回退为 `手机号`
- `pageUrl` / `channel` 可空
- 响应：成功 `{"ok":true}`；失败 `{"ok":false,"error":"..."}`（400 参数错 / 429 限流 / 500 服务端错）
- 服务端自动补 `提交时间` 和 `跟进状态=待跟进`
