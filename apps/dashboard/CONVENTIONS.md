# Dashboard 约定（所有改动必须遵守）

源自 ZCode ui 包 / opencode app 的工程纪律。CI 与架构检查会强制其中大部分。

## 文件所有权（并行工作期，禁止越界）

- 禁止修改共享文件：`src/App.tsx`、`src/api.ts`、`src/lib/api/hooks.ts`、
  `src/components/ChatPanel.tsx`、`src/main.tsx`、`packages/i18n/**`、
  `src/locales/zh-CN.json`、`src/locales/en-US.json`（根级的这两个是聚合入口）。
- 每个 feature 域只在自己的目录写代码，i18n 键写在自己域的 JSON 对里。

## i18n

- 每个域一对文件：`src/locales/<domain>.zh-CN.json` + `<domain>.en-US.json`，
  键名以域名开头（`"toolRenderers.bash.title"`）。聚合器（locales/index.ts）
  已由主会话维护，域文件新建后**不需要**改聚合器以外的任何注册代码——但必须把
  两个 JSON 的内容合并进根级 `src/locales/zh-CN.json` / `en-US.json`？**不要。**
  根级聚合 JSON 是 `{}` 占位 + 手工维护；新建域文件时把同样内容同时写进
  根级 `<locale>.json` 里的 `<domain>` 嵌套键下（聚合器支持嵌套 deep-merge）。
  简化规则：**域 JSON 用嵌套结构，键根 = 域名**；同时把整棵子树复制到根级
  聚合 JSON 的 `<domain>` 键下。两处内容必须一致。
- 代码里用 `t("domain.key")`；占位符 `{name}` 原样保留；禁止硬编码用户可见文案。

## model/presentation 分离

- 每个组件域配一个纯函数模型层（`model.ts` 或 `lib/*.ts`）：输入 unknown/事件，
  输出 typed 视图模型；防御式取值（输入是 passthrough JSON，字段可能缺失）。
- 模型层必须有 vitest 单测（放 `apps/dashboard/test/<domain>.test.ts`）。
- 组件只做渲染与交互；用户可见的空态/加载/错误三态齐全。

## 风格

- prettier：semi false、singleQuote false（跑 `pnpm exec prettier --write <自己文件>`）。
- 不新增 npm 依赖；可用：react、lucide-react、@tanstack/react-query、zustand、
  `@/components/ui/*`（shadcn 原语 23 个）、`@max/i18n`。
- 网络访问只允许 `src/api.ts` 与 `src/hooks/`（arch-boundary.test.ts 强制）。
  需要新端点数据时：在 `src/api.ts` 加 client 函数——**该文件为共享文件**，
  把需要的 client 函数与 zod schema 写成补丁片段放进交付报告，由主会话统一合入。
- 测试放 `apps/dashboard/test/`，命名 `<domain>.test.ts(x)`；测试是 model 层
  单测 + 关键渲染冒烟，不追求快照。

## 验证（交付前必跑）

1. `pnpm --filter @max/dashboard exec tsc -b --force` 零错误
2. `pnpm --filter @max/dashboard exec vitest run test/<自己的测试文件>` 全绿
3. `pnpm exec prettier --check <自己文件>` 干净

## 提交

只 `git add` 自己的目录/文件，`git commit --no-verify`，**不推送**（主会话统一推）。
