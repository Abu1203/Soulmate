# Soulmate

使用 React Native、Expo 和 TypeScript 开发的 AI 角色陪伴 App。当前公开源码版本为 **1.8.1**，主要面向 Android。

用户自行配置模型供应商及 API Key。聊天、角色和长期记忆保存在本地；调用模型时，会将本轮所需的人设、近期对话及召回记忆发送至所选供应商。

## 功能

- 自定义角色、人设、背景及表达偏好，支持普通模式和高级模式。
- 私聊、流式回复、停止生成、回复重新生成。
- 编辑和切换完整 AI 回复版本，以当前生效版本推进剧情；后续历史可保留为可恢复分支。
- 按模型预算选取近期完整对话，目标约 40 轮。
- 周期性长期记忆总结、手动「立即召回」、记忆查看与编辑、删除、核心关系记忆及按需召回。
- 群聊、朋友圈及其角色可见性控制。
- 主题、背景、纯净对话、按回复保存的分段展示设置。
- 番茄钟、小游戏，以及虚构互动使用的转账卡片；转账卡片不涉及真实付款。

模型返回的 `reasoning_content` 与角色生成的内心旁白分别处理。模型、账号或接口不一定支持全部能力；连接测试只验证基本聊天。

## 本地运行

建议使用 Node.js 22、npm 和 Android 开发环境。

```sh
npm ci
npm start
```

如需生成本地 Android 开发构建：

```sh
npm run android
```

项目包含原生依赖，完整验证请使用原生开发构建或 APK。`npm ci` 的 `postinstall` 会应用 Android 大历史记录读取补丁；不要跳过该步骤。补丁针对当前锁定的 AsyncStorage 结构，不修改数据库表结构，依赖升级时需要重新核验。

进入 App 的 AI 服务设置，选择供应商并填写自己的 API Key。可配置 DeepSeek、Kimi、千问、智谱及自定义兼容接口；实际可用模型以供应商账号和服务为准。

## 检查与测试

```sh
npm test
npm run typecheck
npm run release:check
```

自动化测试覆盖存储快照、异常恢复、聊天取消、回复版本和分支、记忆总结与删除、慢存储及部分界面事件链路。原生组件、网络和模型调用在大部分测试中被替换为测试边界，因此通过测试不代表真机或真实模型已经验收。

`tests/android-storage-native-check.cjs` 是独立的 Kotlin/SQLite 检查工具，需要 Java 及脚本列出的 Gradle 缓存依赖，不包含在默认测试命令中。它模拟大行读取异常，不等同于 Android 真机测试。

## 自行构建 APK

本仓库不包含正式签名、凭据、API Key、聊天记录或原作者的 Expo 项目绑定。

1. Fork 或克隆源码，修改 `app.json` 中的应用标识；自行发布建议使用自己的包名。
2. 使用自己的 Expo 账号执行 `npx eas-cli login` 和 `npx eas-cli init`。
3. 执行 `npx eas-cli build --platform android --profile production`，配置自己的 Android 签名。

`eas.json` 的公开配置使用 Expo 托管签名；生成的 APK 不具备原版 Soulmate 的正式签名。覆盖安装及数据继承必须分别核验包名、签名和历史格式。请勿通过卸载应用或清空数据来排查升级问题。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/screens` | 聊天、角色设置、群聊、朋友圈及其他页面 |
| `src/contexts` | 会话状态、请求生命周期及主题 |
| `src/services` | 模型适配、Prompt、上下文、记忆、剧情和存储 |
| `src/components` | 消息气泡、设置控件及弹窗 |
| `tests` | 自动化回归与测试工具 |
| `scripts` | 原生读取补丁及配置检查 |

当前存储使用完整快照和校验副本，超大历史仍可能带来序列化及读取开销。模型响应速度还受上下文、思考模式、服务端及网络影响。

## 许可

MIT，见 [LICENSE](LICENSE)。保留 Expo 模板原有版权声明。
