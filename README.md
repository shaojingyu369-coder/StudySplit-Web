# 留学AA · StudySplit Web

面向合租室友的手机网页。访问网站注册账号，创建宿舍并分享 12 位邀请码；室友加入后，共同查看账单、小票商品和结算记录。

## 在线使用

打开方式：[GitHub Pages 入口](https://shaojingyu369-coder.github.io/StudySplit-Web/)（跳转至实际网站），或[直接打开留学AA](https://studysplit-shaojingyu.tastyseed8.chatgpt.site)。源码仓库：[StudySplit-Web](https://github.com/shaojingyu369-coder/StudySplit-Web)。

1. 每人只填昵称即可进入，昵称可以重复。首次进入时复制并私下保存专属登录码；在这台设备会保持登录，换设备时用登录码找回。
2. 一人创建宿舍，把邀请码发给室友；其他人选择“加入宿舍”。宿舍邀请码可以分享，个人登录码不能分享。
3. 在“记一笔”选择币种、付款人和分摊成员；或者在“小票”拍照/选图，检查识别的商品与价格并发布。
4. 室友可在首页认领待分配商品。结算页按币种给出建议转账。欠款人在线下银行 App 转账后点“我已付款”；只有收款人确认到账，欠款才会核销。

RUB、CNY、USD 分别记账，不自动换算。所有金额以整数最小货币单位计算。小票图片仅在浏览器中识别，不上传到服务器；OCR 与常见俄文商品翻译可能有误，发布前必须核对。网站不会连接银行卡或执行转账。

## 本地开发

环境：Node.js 22.13+。本项目使用 Sites 的 Vinext/Cloudflare D1 运行时；GitHub 存放源码，实际运行网站和共享数据库由 Sites 提供。GitHub Pages 无法单独运行 API 或保存多人共享账单。

```bash
npm ci
npm run db:generate
node /path/to/sites/scripts/build-site.mjs
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_cynical_violations.sql
npm run dev
node tests/smoke.mjs
npx tsc --noEmit
```

在 `.openai/hosting.json` 中设置站点 ID 和 `DB` 绑定，发布时运行 SQL 迁移。生产数据只存在站点 D1 数据库，不存于 GitHub。

## 账务和安全

- 后端校验账号、宿舍成员身份、收款人身份和账单权限；每间宿舍通过单行版本号条件更新，避免并发重复认领与重复核销。
- 付款登记具有幂等键；重复确认只返回已有记录，不再创建结算。
- 错误账单可由创建者或管理员软删除，已确认结算后的历史账单不可删除。
- 昵称快速进入会生成独立的随机身份和高强度登录码，数据库仅保存登录码哈希；原密码账号仍可登录，密码哈希使用 PBKDF2。随机会话令牌只保留哈希，Cookie 为 HttpOnly、SameSite=Lax；写请求检查同源。
- 登录码可在“我的”中重新生成，旧码会失效。当前没有短信/邮件找回、验证码或限流；请把登录码私下保存，邀请码只发给可信室友。

## 目录

- `app/`：手机网页与 API 路由
- `lib/`：身份、宿舍业务和精确金额账务核心
- `db/`、`drizzle/`：数据库定义和迁移
- `tests/smoke.mjs`：多人共享、认领、部分还款、权限与幂等测试

原微信小程序保留在本机的 `StudySplit` 文件夹，不影响此网页版。
