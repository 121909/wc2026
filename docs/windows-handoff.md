# Windows 开发与测试交接

## 1. 交付状态

当前交付物是 Windows WPF v0.1 被动对局记录器代码和记录格式文档。交付期间使用临时 .NET 8 SDK 完成 Windows 交叉目标的 Release restore/build，结果为 0 警告、0 错误；没有运行测试，也未运行 Windows/WPF 或 Hearthstone 实机验证。仓库已提供 Windows restore/build 工作流；下面的检查项供转入 Windows 后手工完成并记录。

## 2. 前置条件

- Windows 10 22H2 或 Windows 11，建议使用仍受支持的 Windows 11。
- x64 桌面环境；v0.1 的交接目标不包含 ARM64 验证。
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)，不是仅安装 Runtime。
- 支持当前补丁的 Hearthstone Windows 客户端。
- 对以下目录具有当前用户读写权限：
  - `%LOCALAPPDATA%\Blizzard\Hearthstone`
  - `%LOCALAPPDATA%\HearthstoneAgent`
- Git for Windows；Visual Studio 2022 17.8+ 可选。如使用 Visual Studio，安装“.NET 桌面开发”工作负载。

验证 SDK：

```powershell
dotnet --info
dotnet --list-sdks
```

输出中应包含 `8.0.x` SDK。

## 3. 构建和运行

在仓库根目录执行：

```powershell
dotnet restore
dotnet build --configuration Debug --no-restore
dotnet run --project .\src\HearthstoneAgent.App\HearthstoneAgent.App.csproj
```

发布一个本机调试目录时可使用：

```powershell
dotnet publish .\src\HearthstoneAgent.App\HearthstoneAgent.App.csproj `
  --configuration Release `
  --runtime win-x64 `
  --self-contained false
```

仓库的 Windows GitHub Actions 工作流只执行 restore/build，不运行测试。Windows 接手人完成实际测试后，应将环境和结果写入 issue、提交说明或后续测试记录，不要把真实运行数据直接提交。

### 3.1 首次使用界面

1. 启动应用后检查 `Power.log` 路径；日志已存在时可以点“自动定位”，也可以点“浏览”。
2. 确认记录输出目录，默认是 `%LOCALAPPDATA%\HearthstoneAgent`。
3. 根据本轮目标选择是否勾选“启动时回读当前 Power.log 中已有的内容”。默认不勾选，只监听新追加内容；回放现有日志时再手动启用。
4. 点“开始记录”。应用会在此时校验并保存界面设置，然后进入“监听中”或“等待日志”。
5. 识别到 `CREATE_GAME` 后，界面会显示 `Match ID`、回合、事件和实体计数。
6. 对局结束后检查保存路径；离开前点“停止记录”，等待状态变为“已停止”再关闭应用。

界面保存的是显式日志路径。如果 Hearthstone 重启后改用新的时间戳日志目录，应在该日志出现后重新点“自动定位”或“浏览”，不要继续等待旧文件增长。

## 4. 启用 Power.log

### 4.1 默认位置

记录器优先查找：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\Power.log
```

可在 PowerShell 中确认：

```powershell
$hearthstoneHome = Join-Path $env:LOCALAPPDATA 'Blizzard\Hearthstone'
$powerLog = Join-Path $hearthstoneHome 'Logs\Power.log'
Get-Item $powerLog -ErrorAction SilentlyContinue
```

设置文件可使用展开后的绝对路径，也可以使用实现能够展开的 `%LOCALAPPDATA%` 环境变量写法。通过界面选择文件时以界面保存的实际值为准。

### 4.2 创建或更新 log.config

完全退出 Hearthstone。打开以下文件；不存在时以纯文本新建：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\log.config
```

确保至少包含：

```ini
[Power]
LogLevel=1
FilePrinting=true
ConsolePrinting=false
ScreenPrinting=false
Verbose=true
```

注意：

- 记录器不会自动修改这个文件。
- 如果已有 `[Power]` 节，请合并键值，不要重复创建同名节。
- 确认文件名是 `log.config`，不是被资源管理器隐藏扩展名后的 `log.config.txt`。
- 保存后重新启动 Hearthstone，并进入一场练习或双方知情的友谊赛。
- `log.config` 的可用键可能随客户端补丁变化；若不产生日志，先核对 Blizzard 当前客户端行为，再记录实际差异。

检查日志是否增长：

```powershell
Get-Content $powerLog -Tail 20 -Wait
```

按 `Ctrl+C` 结束观察。不要在公开 issue 中粘贴未经脱敏的完整日志。

## 5. 本地设置和输出

应用数据默认位于：

```text
%LOCALAPPDATA%\HearthstoneAgent
```

本地设置为：

```text
%LOCALAPPDATA%\HearthstoneAgent\settings.json
```

对局记录为：

```text
%LOCALAPPDATA%\HearthstoneAgent\sessions\{sessionId}\{matchId}\
```

首次点击“开始记录”后再以应用实际生成的 `settings.json` 为准。优先通过界面更改路径和回读开关；需要手工编辑时先退出应用，并保留 JSON 结构和 `schemaVersion`。不要把机器专属路径或本地设置提交到仓库。

## 6. 建议的测试记录模板

每轮人工验证至少记下：

```text
应用提交/版本：
Windows 版本及体系结构：
.NET SDK：
Hearthstone 构建号：
客户端语言：
游戏模式：练习 / 双方知情的友谊赛
Power.log 实际路径：
是否发生日志轮转/重连：
开始时间（UTC）：
结束时间（UTC）：
各检查项结果：通过 / 失败 / 未执行
失败现象与最小脱敏证据：
```

测试样本如需入库，必须先脱敏并缩减为能复现问题的最小片段，同时记录游戏构建、语言和预期时间线。

## 7. 人工测试清单

以下项目尚未在 Windows/Hearthstone 实机环境中执行。

### A. 构建与启动

- [ ] 全新克隆后 `dotnet restore` 成功。
- [ ] Debug 和 Release 构建均成功且没有新增警告。
- [ ] WPF 应用能以普通用户启动，不要求管理员权限。
- [ ] 首次启动能创建应用数据目录；保存设置后能生成有效的 `settings.json`。
- [ ] UI 清楚显示“等待日志”“监听中”“对局中”“已停止”或相应错误状态。

### B. 日志发现

- [ ] 没有 `Power.log` 时应用保持响应，不崩溃、不忙循环，并提示候选路径。
- [ ] Hearthstone 稍后创建日志后，应用无需重启即可开始监听。
- [ ] 默认路径存在时能自动选中正确文件。
- [ ] 只有时间戳子目录中的 `Power.log` 存在时，“自动定位”选择最后更新的候选。
- [ ] 显式日志路径停止更新后，UI 不会误称正在接收新事件；重新定位后能切换到实际活动文件。
- [ ] 配置显式绝对路径后能使用该文件。
- [ ] 无权限、路径是目录、文件被删除等情况保持响应并展示实际路径；记录当前提示是否足以区分原因。

### C. 增量读取

- [ ] `readExistingLogOnStart=true` 时确认会回读现有内容；设为 `false` 时确认从首次打开时的文件末尾开始等待新增内容。
- [ ] 日志持续追加时 UI 和 JSONL 都能及时更新。
- [ ] 文件暂时无新内容时 CPU 占用保持合理。
- [ ] 日志截断、轮转或客户端重启后能恢复或明确标记记录缺口。
- [ ] 应用停止并再次启动后不会把旧对局与新对局写进同一个 `matchId`；同时记录回读设置是否生成重复的历史对局目录。
- [ ] 非 ASCII 玩家名和本地化日志不会造成编码异常或 JSON 损坏。

### D. 对局生命周期

- [ ] 进入练习/友谊赛后只创建一个新 `matchId` 目录。
- [ ] 起手阶段、回合变化和结束证据能产生预期的规范事件。
- [ ] 一场对局内 `sequence` 严格递增。
- [ ] 正常胜利、正常失败和认输均生成与事实相符的摘要。
- [ ] 核对玩家名形式的 `CURRENT_PLAYER`、`PLAYSTATE` 是否能映射到正确玩家实体。
- [ ] 核对对手隐藏手牌在 `BLOCK_START` 后才 `SHOW_ENTITY` 时，已出卡牌列表能够补记。
- [ ] 中途关闭应用、游戏崩溃和断线重连不会虚构胜负。
- [ ] 连续进行两场对局时目录和摘要互不覆盖。

### E. 文件格式与恢复

- [ ] 每个 JSONL 非空行都能独立反序列化。
- [ ] `matchId`、`schemaVersion`、时间和事件顺序字段符合格式文档。
- [ ] 原始行引用能够关联到对应规范事件。
- [ ] 快照内容与当时 UI 的最小状态一致。
- [ ] `summary.json` 使用完整 JSON，对不确定结果使用 `null` 或明确状态。
- [ ] 模拟末行被截断后，读取工具能忽略并报告坏行，不篡改前面的记录。
- [ ] 磁盘写满或目录不可写时应用显示错误并停止宣称正常记录。

### F. 停止、隐私与安全边界

- [ ] 点击停止后不再读取新行，文件句柄及时释放。
- [ ] 关闭窗口不会留下异常后台进程。
- [ ] 应用未向 Hearthstone 窗口发送鼠标或键盘输入。
- [ ] 应用未修改 `log.config` 或 Hearthstone 安装目录。
- [ ] 输出中不包含 API Key、认证头或与对局无关的环境变量。
- [ ] 删除 `%LOCALAPPDATA%\HearthstoneAgent` 后应用可重新建立干净环境。

### G. 性能与终局尾部

- [ ] 长局中记录器内存增长和 UI 延迟保持可接受，并记录峰值事件速率。
- [ ] 手动启用历史回读时 UI 不长时间失去响应；历史摘要不被误当成真实对局时长。
- [ ] 检查终局识别后紧随其后的 `BLOCK_END` 或其他尾部日志，记录当前丢弃范围供后续版本优化。

## 8. 已知限制与排查顺序

遇到“没有记录”时依次确认：

1. Hearthstone 已完全重启，且 `log.config` 路径和扩展名正确。
2. `Power.log` 确实出现并在对局中增长。
3. 应用 UI 展示的实际监听路径与增长中的文件一致。
   如果 Hearthstone 使用新的时间戳日志目录，重新执行界面的“自动定位”或“浏览”。
4. 当前用户对日志有读取权限，对应用数据目录有写入权限。
5. 客户端补丁是否改变了日志目录或关键文本。
6. 应用输出目录中是否已经写入原始行，但解析器没有识别事件。

不要为了绕过权限问题以管理员身份长期运行。先修复当前用户目录权限或配置正确路径，并保留最小脱敏证据。

## 9. 交接后的优先事项

1. 执行本页清单并记录环境矩阵。
2. 选一场短的练习对局，对照 `Power.log`、JSONL 和人工时间线。
3. 修复首个真实补丁下的解析差异，并补充脱敏黄金样本。
4. 验证轮转、异常退出和连续对局，再考虑 SQLite 或更完整状态模型。
