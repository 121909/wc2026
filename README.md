# Hearthstone Agent

一个面向《炉石传说》Windows 客户端的本地智能决策项目。当前可交付版本是 **v0.1 被动对局记录器**：实时读取 `Power.log`，展示基础对局状态，并将原始日志证据、规范事件、状态快照和对局摘要保存在本机。

v0.1 不调用模型、不控制鼠标键盘，也不包含自动对局能力。它先解决后续 Agent 最重要的基础问题：能否稳定、可复现地记录一场对局。

## v0.1 功能

- Windows 10/11、.NET 8、WPF 桌面应用。
- 自动查找 Hearthstone `Power.log`，也可以手动选择路径。
- 增量读取日志，并等待文件创建、处理截断或日志目录切换。
- 解析 `CREATE_GAME`、实体、标签、区块、选择和操作选项等基础事件。
- 维护回合、阶段、当前玩家、实体和已观察卡牌等最小状态。
- 按运行会话和对局保存 JSONL 事实记录及 `summary.json`。
- 在界面中展示记录状态、对局 ID、回合、实体数和最近事件。
- 应用停止或关闭时收尾当前记录，不把不完整对局虚构成胜负。

## Windows 构建

需要安装 [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)。在仓库根目录运行：

```powershell
dotnet restore HearthstoneAgent.sln
dotnet build HearthstoneAgent.sln --configuration Debug --no-restore
dotnet run --project .\src\HearthstoneAgent.App\HearthstoneAgent.App.csproj
```

详细环境准备、`log.config` 配置和人工检查项见 [Windows 开发与测试交接](docs/windows-handoff.md)。

## Power.log

默认查找位置：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\Power.log
```

如果没有生成日志，完全退出 Hearthstone，在下面的位置创建或更新 `log.config`：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\log.config
```

至少包含：

```ini
[Power]
LogLevel=1
FilePrinting=true
ConsolePrinting=false
ScreenPrinting=false
Verbose=true
```

保存后重新启动 Hearthstone。应用不会自动修改该配置文件。

## 记录目录

默认保存在：

```text
%LOCALAPPDATA%\HearthstoneAgent\
├── settings.json
└── sessions\
    └── {sessionId}\
        └── {matchId}\
            ├── raw-lines.jsonl
            ├── events.jsonl
            ├── snapshots.jsonl
            └── summary.json
```

运行数据可能包含玩家名称、本机路径和对局时间，不应直接提交到 Git 或公开分享。字段定义见 [v0.1 记录格式](docs/record-format.md)。

## 项目状态

本版本在非 Windows 环境完成代码交付，并通过 .NET 8 的 Windows 交叉目标 Release 编译（0 警告、0 错误）。尚未运行 WPF 界面或 Hearthstone 实机测试。仓库包含只做 restore/build 的 Windows GitHub Actions 工作流；转移到 Windows 后应按交接文档记录首次运行及日志差异。

## 文档

- [v0.1 记录器说明](docs/07-recording-v0.1.md)
- [Windows 开发与测试交接](docs/windows-handoff.md)
- [v0.1 记录格式](docs/record-format.md)
- [产品需求](docs/01-product-requirements.md)
- [系统架构](docs/02-system-architecture.md)
- [领域与数据模型](docs/03-domain-model.md)
- [决策引擎](docs/04-decision-engine.md)
- [实施路线与验收](docs/05-roadmap-and-acceptance.md)
- [风险、合规与运行边界](docs/06-risk-and-compliance.md)
- [变更记录](CHANGELOG.md)
- [协作约定](CONTRIBUTING.md)

## 工程边界

- 状态正确性优先于模型能力。
- 隐藏信息保持未知，不能把推断写成事实。
- 自动动作必须来自合法动作集合，并在执行前后校验状态。
- 不设计进程注入、内存读取、网络封包修改、反检测或安全机制绕过。
- 无人值守参与公开匹配可能违反游戏服务条款；后续自动执行必须单独评审。
