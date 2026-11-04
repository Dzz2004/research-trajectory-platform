# 研迹 · 科研轨迹工作台

将一篇科研总结整理成可核对的结构化轨迹。支持粘贴 Markdown 或上传 UTF-8 `.md` / `.markdown` 文稿；后端调用模型提取，贡献者对照原稿修改、确认，再导出 JSON 或 Markdown。

## 启动

需要 Node.js 22.14 或更高版本。启动脚本会尝试查找 PATH、fnm 和 nvm 中的 Node；目前提供 Bash 启动脚本，Windows 可通过 WSL 运行。

```bash
git clone https://github.com/Dzz2004/research-trajectory-platform.git
cd research-trajectory-platform
cp .env.example .env
# 编辑 .env，填写模型服务配置；也可暂不配置，先查看内置示例。
./start.sh
```

浏览器打开 <http://localhost:8787>。默认仅监听 `127.0.0.1`。开发时使用 `./start.sh --dev`，前后端仍使用同一个端口。代码修改后，生产模式需重新执行 `npm run build` 并重启服务。

首次运行时，`start.sh` 在依赖缺失时运行 `npm ci`，在构建产物缺失时运行构建。后续启动直接执行 `./start.sh`，无需重新复制 `.env`。

## 模型配置

在 `.env` 中填写模型配置。也可设置 `LLM_CONFIG_FILE=/absolute/path/to/api.json`，引用包含 `URL`、`KEY`、`model` 的本地 JSON 文件。配置仅由后端读取；密钥和配置文件不随仓库分发，迁移到新机器时需要重新配置。

直接配置环境变量的示例：

```dotenv
PORT=8787
HOST=127.0.0.1
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model
LLM_TIMEOUT_MS=180000
```

接口采用兼容 OpenAI 的 `POST /chat/completions` 协议。`LLM_BASE_URL` 如已包含 `/chat/completions` 则直接使用，否则追加这个路径；服务商要求 `/v1` 时须将其写入地址。服务不会自行猜测接口路径。按用户要求，请求不发送 `max_tokens` 或 `max_completion_tokens`，不在客户端设置 token 上限；服务端仍可能有自身默认限制。

没有模型配置时，可以保存原稿并浏览明确标记的模拟示例。真实提取失败会显示错误，保留原稿和已有版本；不会用模拟数据替代。

## 使用

1. 在“新建研究记录”粘贴文稿或上传 Markdown，选择文稿来源。
2. 点击“生成科研轨迹”。原稿先保存，提取任务在后台执行，刷新后仍可查看进度。
3. 查看“轨迹概览”和“原稿对照”。点击出处可定位行号，点击过程节点可查看或编辑详细字段。
4. 在“结构编辑”修改完整 JSON，可调整输入、输出、关系和待补充问题。保存会校验并创建新版本；改义内容默认标记为人工补充。
5. 核对后点击“确认此版本”，再导出 JSON / Markdown。确认表示贡献者核对记录，不代表科研结论被验证。版本记录可查看旧版本，导出始终指向明确保存的版本。

文稿上限为 30,000 个 Unicode 字符及 256 KiB。上传需 UTF-8 编码；原稿不可覆盖，新增内容应在轨迹中标为人工补充，或作为新记录提交。

## 轨迹约定

核心结构保持简单：`inputs → nodes → outputs`，另用 `relations` 连接，用 `gaps` 记录信息缺口。

- 输入：目标、约束、背景信息、人为条件。
- 过程节点仅两种：`reasoning`（思考／决策）、`action`（查文献、实验、计算等动作）。
- 输出：方案、假设结论、负面发现、开放问题等；方案本身可以是有效产出。
- `precedes` 表达明确先后，`parallel` 表达明确并行，`supports` 表达论证依据。论证顺序和段落顺序不自动转成历史时序。
- `provenance` 记录原文出处、推断或人工补充；`occurrence` 区分报告发生、计划、未知。
- 不明确当时已知信息时，`known_before_ids` 为 `null`。动作没有结果时，`result` 为 `null`。

过程图按有依据的先后关系排列，明确并行才合组。没有先后证据的节点显示在“时序未提供”区域；所有论证关系另外列出。图是轨迹的阅读视图，保存和导出使用同一份 JSON。

严格结构与引用校验见 [shared/schema.mjs](shared/schema.mjs)。原始产品和形式化说明保存在 [docs](docs/)；其中 JSON 示例也用于内置样例。结构检查能验证类型、引用片段和图关系一致性，不能证明模型理解正确或科研事实真实，因此保留人工核对环节。

## 工程结构与数据

```text
src/                 React + TypeScript 页面
server/              Express API、模型提取、SQLite 持久化、导出
shared/              Zod 结构、语义校验、过程图布局
examples/            明确标记的模拟轨迹
tests/               结构和 HTTP 集成测试
docs/                产品需求、形式化规范与本机验收记录
data/                运行时 SQLite 数据（自动生成、不提交）
```

SQLite 使用 Node 内置 `node:sqlite`，首次运行可能显示实验性功能提示。原稿、提取尝试、模型响应和不可变轨迹版本保存在 `data/`；目录包含科研内容，备份时应妥善保存。停止服务后备份整个目录最简单。`.env`、`data/`、依赖、构建产物及截图均已加入忽略规则。

当前是本机单用户 MVP：没有登录、团队权限、异步任务队列或部署配置。进程中断的提取任务在重启后标记失败，可手动重试。

## 验证

```bash
npm run check
```

包含 TypeScript 检查、生产构建和 16 项测试，覆盖精确引用、时序循环、并行冲突、决策前信息、人工修改溯源、保存确认、旧版本保留、导出，以及首次调用与修复调用不发送客户端 token 上限。HTTP 集成测试需要允许监听本机临时端口。

2026-11-03 已使用用户提供的接口完成一次真实提取，并通过 Chromium 验证编辑、确认、历史版本和 Markdown 导入。详见 [本机验收记录](docs/03_本机验收记录.md)。

随后对原规范 1.1 做了 2,598 字的模拟扩写，包含并行调研、候选取舍、小试反馈和未执行计划，并实际调用模型对照核查。输入、原始响应、成功/失败调用记录和发现的问题见 [扩写实测报告](examples/expanded-1.1/README.md)。
