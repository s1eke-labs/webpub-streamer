# Repository Guidelines

## 项目结构与模块划分
`src/` 是库源码目录。核心生命周期与公开类型在 `src/core`，格式解析在 `src/parse/epub` 和 `src/parse/txt`，产物组装在 `src/materialize`。运行时挂载、Service Worker、Worker 与持久化分别位于 `src/mount`、`src/service-worker`、`src/workers`、`src/store/idb`。公开入口为 `src/index.ts`、`src/sw.ts`、`src/testing.ts`。测试代码位于 `tests/unit`、`tests/integration`、`tests/harness`、`tests/helpers`，测试用 schema 在 `tests/fixtures/schemas`。

## 构建、测试与开发命令
`npm run build`：使用 Vite 打包库，并通过 `tsc -p tsconfig.build.json` 生成类型声明。
`npm run typecheck`：执行严格 TypeScript 检查，不输出构建产物。
`npm run lint`：使用 ESLint 9 和 `eslint-config-ali` 检查代码；`npm run lint:fix` 可修复安全项。
`npm run test:unit`：运行 Vitest 单元测试，覆盖解析、存储和核心流程。
`npm run test:integration`：运行 Playwright 集成测试，对接 `tests/harness` 本地测试页。
`npm test`：先跑单元测试，再跑集成测试；集成测试前会自动执行构建。

## 代码风格与命名约定
使用 TypeScript ESM、2 空格缩进、保留分号；在 `.ts` 文件的相对导入中显式写 `.js` 扩展名。模块按职责拆分，不按“工具大杂烩”组织。函数和变量使用 `camelCase`，导出的类型、接口和 React 组件使用 `PascalCase`，文件名保持语义明确，例如 `createPublicationServiceWorkerHandler.ts`。导入顺序遵循现有风格：第三方依赖在前，本地模块在后。

## 测试规范
快速行为验证放在 `tests/unit/**/*.test.ts`，浏览器或 Service Worker 相关验证放在 `tests/integration/**/*.spec.ts`。涉及解析逻辑、manifest 生成、IndexedDB 行为的改动，应补充单元测试；影响 harness、挂载流程或 Thorium 兼容性的改动，应补充集成测试。Vitest 已配置文本和 `lcov` 覆盖率输出。仓库未设置硬性覆盖率门槛，但新增行为必须带针对性测试。

## 提交与合并请求规范
沿用仓库现有的 Conventional Commit 风格：`feat: ...`、`fix: ...`、`chore: ...`。提交标题保持简短、具体，例如 `fix: 处理 TXT 章节边界识别`。提交 PR 时请说明改动目的、影响范围、已执行命令（如 `npm run lint`、`npm test`），只有在 harness 界面行为变化时再附截图。
