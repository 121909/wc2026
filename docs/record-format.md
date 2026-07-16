# v0.1 对局记录格式

## 1. 适用范围

本文定义 Windows 被动记录器 v0.1（`schemaVersion: 1`）写出的本地文件。它是当前实现契约，不代表后续完整领域模型。

默认目录（`raw-lines.jsonl` 可通过设置关闭）：

```text
%LOCALAPPDATA%\HearthstoneAgent\sessions\{sessionId}\{matchId}\
├── raw-lines.jsonl
├── events.jsonl
├── snapshots.jsonl
└── summary.json
```

`sessionId` 和 `matchId` 同时参与目录隔离。读取记录时必须保留两层目录上下文，不能只根据文件名合并不同对局。

## 2. 通用编码规则

- 文件使用 UTF-8 JSON。
- `*.jsonl` 遵循 JSON Lines：每个非空物理行是一个完整 JSON 对象，行尾使用平台换行符。
- 属性名采用 `camelCase`。
- 枚举值使用 `camelCase` 字符串，例如 `tagChange`。
- GUID 使用标准带连字符字符串，例如 `26fa53cd-37cf-4d6b-a24a-dac934ae0953`。
- 时间使用带 UTC 偏移的 ISO 8601/RFC 3339 兼容字符串，例如 `2026-07-16T10:11:12.3456789+00:00`。
- 可空属性在值为 `null` 时通常从 JSON 中省略；读取端必须把“字段缺失”解释为未知，而不是零、空字符串或失败。
- 数字不使用字符串包装。字典的整数键受 JSON 对象限制，会表现为字符串属性名，例如 `"64"`。
- JSONL 是追加式事实记录；不要原地改写已落盘行。
- `summary.json` 和快照是派生记录。发生冲突时，优先保留原始行，再检查规范事件和解析器版本。

## 3. `raw-lines.jsonl`

每行对应从 `Power.log` 观察到的一行原文。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 当前为 `1` |
| `sessionId` | string | 是 | 本次记录器会话标识 |
| `matchId` | GUID string | 是 | 本地对局标识，应与父目录名一致 |
| `sourcePath` | string | 是 | 当时读取的日志绝对路径，分享前需要脱敏 |
| `fileGeneration` | integer | 是 | 跟随器检测到的文件代次；轮转或截断后递增 |
| `lineNumber` | integer | 是 | 当前文件代次内的来源行号 |
| `byteOffset` | integer | 是 | 该行在当前文件代次中的起始字节偏移 |
| `observedAtUtc` | string | 是 | 记录器观察到该行的 UTC 时间，不是游戏服务器时间 |
| `content` | string | 是 | 不含物理换行符的日志原文 |

示例：

```json
{"schemaVersion":1,"sessionId":"20260716T101000123Z_a1b2c3d4","matchId":"26fa53cd-37cf-4d6b-a24a-dac934ae0953","sourcePath":"C:\\Users\\<user>\\AppData\\Local\\Blizzard\\Hearthstone\\Logs\\Power.log","fileGeneration":1,"lineNumber":1204,"byteOffset":148233,"observedAtUtc":"2026-07-16T10:11:12.3456789+00:00","content":"D 10:11:12.3000000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=1"}
```

原始行从触发新对局的 `CREATE_GAME` 行开始写入；在没有活动对局时，跟随器读到的其他行不会写入对局目录。`persistRawLines: false` 时该文件不存在，但事件和快照仍可写入。

## 4. `events.jsonl`

每行是解析器从原始行生成的一条 `CanonicalGameEvent`。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 当前为 `1` |
| `matchId` | GUID string | 是 | 本地对局标识，应与父目录名一致 |
| `sequence` | integer | 是 | 当场严格递增的规范事件序号 |
| `observedAtUtc` | string | 是 | 来源行被观察到的 UTC 时间 |
| `type` | string | 是 | 规范事件类型，见下表 |
| `entityId` | integer | 否 | 可解析的当场实体 ID |
| `cardId` | string | 否 | 已公开且可解析的卡牌 ID |
| `playerId` | integer | 否 | 可解析的玩家 ID |
| `tag` | string | 否 | 标签名 |
| `value` | string | 否 | 保留语义的标签/事件值；未在 v0.1 强制转换为数字 |
| `rawLineNumber` | integer | 是 | 来源原始行号 |
| `rawByteOffset` | integer | 是 | 来源原始行的字节偏移 |
| `data` | object<string,string> | 是 | 解析器保留的额外键值；允许为空对象 |

v0.1 支持的 `type` 值：

```text
unknown
createGame
fullEntity
showEntity
hideEntity
changeEntity
tagChange
blockStart
blockEnd
choicesStart
choice
choicesEnd
optionsStart
option
optionsEnd
sendOption
```

示例：

```json
{"schemaVersion":1,"matchId":"26fa53cd-37cf-4d6b-a24a-dac934ae0953","sequence":18,"observedAtUtc":"2026-07-16T10:11:12.3456789+00:00","type":"tagChange","tag":"TURN","value":"1","rawLineNumber":1204,"rawByteOffset":148233,"data":{"entity":"GameEntity"}}
```

注意：

- 同一来源行可以产生零条或一条受支持的规范事件；无法识别的原始内容仍可保留在 `raw-lines.jsonl`。
- `data` 是兼容扩展区。读取端应忽略不认识的键，同时保留其原值。
- v0.1 的事件来源引用没有 `fileGeneration`。发生轮转时，`rawLineNumber` 与 `rawByteOffset` 必须结合文件时间线人工解释，这是已知限制。
- `unknown` 是当前枚举中的预留值。v0.1 解析器遇到不支持的行时通常只保留原始证据，不主动产出 `unknown` 事件。

## 5. `snapshots.jsonl`

每行是某个事件版本后的 `GameStateSnapshot`。快照用于查看和恢复优化，不取代事件流。

### 5.1 顶层字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 当前为 `1` |
| `matchId` | GUID string | 是 | 本地对局标识 |
| `version` | integer | 是 | 状态归约版本，用于定位产生快照的事件进度 |
| `capturedAtUtc` | string | 是 | 快照创建时间 |
| `startedAtUtc` | string | 是 | 记录器识别的对局开始时间 |
| `endedAtUtc` | string | 否 | 识别到的结束时间 |
| `turn` | integer | 是 | 当前已知回合；未知/尚未开始时可能为 `0` |
| `step` | string | 否 | 当前已知游戏步骤原始值 |
| `currentPlayerId` | integer | 否 | 当前行动玩家 ID |
| `friendlyPlayerId` | integer | 否 | 已识别的己方玩家 ID |
| `winnerPlayerId` | integer | 否 | 已识别的胜方玩家 ID |
| `outcome` | string | 否 | `Win`、`Loss`、`Tie` 或 `Unknown`；尚未完成时省略 |
| `isComplete` | boolean | 是 | 是否观察到足以结束记录的证据 |
| `blockDepth` | integer | 是 | 当前嵌套 `BLOCK` 深度 |
| `isChoosing` | boolean | 是 | 当前是否处于已识别的选择上下文 |
| `hasOptions` | boolean | 是 | 当前是否存在已识别的 options 上下文 |
| `actionCount` | integer | 是 | 状态归约器累计观察到的 `sendOption` 事件数 |
| `entities` | object | 是 | 按实体 ID 索引的实体快照 |
| `playedCardsByPlayer` | object | 是 | 按玩家 ID 索引的已观察到打出卡牌 ID 列表 |

### 5.2 实体字段

`entities` 的每个值为 `GameEntitySnapshot`：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `entityId` | integer | 是 | 当场实体 ID |
| `cardId` | string | 否 | 已知卡牌 ID |
| `name` | string | 否 | 日志中可用的实体名 |
| `playerId` | integer | 否 | 关联玩家 ID |
| `controllerId` | integer | 否 | 当前控制者 ID |
| `zone` | string | 否 | 当前区域原始值 |
| `zonePosition` | integer | 否 | 区域内位置 |
| `isVisible` | boolean | 是 | v0.1 对该实体的可见性认识 |
| `tags` | object<string,string> | 是 | 当前已知标签；允许为空对象 |

示例（为便于阅读已格式化；真实 JSONL 每个对象仍占一行）：

```json
{
  "schemaVersion": 1,
  "matchId": "26fa53cd-37cf-4d6b-a24a-dac934ae0953",
  "version": 18,
  "capturedAtUtc": "2026-07-16T10:11:12.4000000+00:00",
  "startedAtUtc": "2026-07-16T10:10:55.0000000+00:00",
  "turn": 1,
  "step": "MAIN_READY",
  "isComplete": false,
  "blockDepth": 0,
  "isChoosing": false,
  "hasOptions": false,
  "actionCount": 0,
  "entities": {
    "64": {
      "entityId": 64,
      "cardId": "EXAMPLE_001",
      "controllerId": 1,
      "zone": "PLAY",
      "zonePosition": 1,
      "isVisible": true,
      "tags": {"ZONE":"PLAY"}
    }
  },
  "playedCardsByPlayer": {"1":["EXAMPLE_001"]}
}
```

示例中的卡牌 ID 仅用于说明格式，不是测试事实。

## 6. `summary.json`

`summary.json` 是一场对局结束或记录器收尾时写出的 `MatchSummary`，使用缩进 JSON，不是 JSONL。强制终止进程、断电或无法写入目录时可能没有摘要。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 当前为 `1` |
| `sessionId` | string | 是 | 本次记录器会话标识 |
| `matchId` | GUID string | 是 | 本地对局标识 |
| `startedAtUtc` | string | 是 | 对局开始时间 |
| `endedAtUtc` | string | 否 | 对局结束或收尾时间 |
| `durationSeconds` | number | 否 | 根据已知开始/结束时间计算的秒数 |
| `turnCount` | integer | 是 | 最后已知回合数 |
| `eventCount` | integer | 是 | 当场规范事件总数 |
| `entityCount` | integer | 是 | 最终状态中的实体数 |
| `friendlyPlayerId` | integer | 否 | 已识别的己方玩家 ID |
| `winnerPlayerId` | integer | 否 | 已识别的胜方玩家 ID |
| `outcome` | string | 否 | `Win`、`Loss`、`Tie` 或 `Unknown`；尚未完成时省略 |
| `isComplete` | boolean | 是 | 是否观察到正常完成所需的结束证据 |
| `completionReason` | string | 是 | `GameCompleted`、`NewGameDetected`、`RecorderStopped` 或 `RecorderFaulted`；读取端应允许未来新增值 |
| `playedCardsByPlayer` | object | 是 | 按玩家 ID 索引的已观察打出卡牌 ID 列表 |

示例：

```json
{
  "schemaVersion": 1,
  "sessionId": "20260716T101000123Z_a1b2c3d4",
  "matchId": "26fa53cd-37cf-4d6b-a24a-dac934ae0953",
  "startedAtUtc": "2026-07-16T10:10:55+00:00",
  "endedAtUtc": "2026-07-16T10:23:10+00:00",
  "durationSeconds": 735,
  "turnCount": 12,
  "eventCount": 842,
  "entityCount": 94,
  "friendlyPlayerId": 1,
  "winnerPlayerId": 1,
  "outcome": "Win",
  "isComplete": true,
  "completionReason": "GameCompleted",
  "playedCardsByPlayer": {
    "1": ["EXAMPLE_001"],
    "2": ["EXAMPLE_002"]
  }
}
```

`outcome` 和 `winnerPlayerId` 缺失时，不能从目录存在、持续时间或应用关闭行为推导胜负。`isComplete: false` 的摘要仍然有诊断价值，但不能计入正式胜负统计。

## 7. `settings.json`

设置文件不属于对局事实，但 Windows 接手时会直接使用：

```json
{
  "schemaVersion": 1,
  "powerLogPath": null,
  "dataDirectory": "C:\\Users\\<user>\\AppData\\Local\\HearthstoneAgent",
  "readExistingLogOnStart": false,
  "pollIntervalMilliseconds": 250,
  "snapshotEveryEvents": 25,
  "persistRawLines": true
}
```

当前设置含义：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 设置格式版本 |
| `powerLogPath` | `null` | 为空时自动发现；非空时为绝对路径或可展开环境变量的路径 |
| `dataDirectory` | 本地应用目录 | 会话记录根目录 |
| `readExistingLogOnStart` | `false` | 是否从启动时已存在日志的开头读取；启用后的历史摘要使用本次读取时间，不能表示真实对局时长 |
| `pollIntervalMilliseconds` | `250` | 文件轮询间隔；实现会把值限制在 100–10000 ms |
| `snapshotEveryEvents` | `25` | 周期快照事件间隔；实现会把值限制在 1–10000 |
| `persistRawLines` | `true` | 是否保存原始行证据 |

使用实际生成的设置文件为准。序列化时空值可能被省略，因此省略 `powerLogPath` 与使用 `null` 具有相同的自动发现含义。

## 8. 容错读取要求

后续回放或分析工具至少应做到：

1. 逐行读取 JSONL，单行损坏不丢弃之前已成功解析的行。
2. 报告文件名、物理行号和错误，不静默跳过。
3. 拒绝未知的更高 `schemaVersion`，或明确进入只读尽力模式。
4. 允许对象出现未来新增字段，不因扩展字段失败。
5. 校验目录 `matchId`、事件 `matchId`、快照 `matchId` 和摘要 `matchId` 一致。
6. 校验事件 `sequence` 严格递增，并报告重复或倒序。
7. 不根据省略字段补造隐藏信息。
8. 对 `isComplete: false` 的记录单独分类。

## 9. v0.1 格式限制

- 规范事件来源引用没有 `fileGeneration`。
- 没有游戏构建号、客户端语言、规则版本或解析器版本字段。
- 没有内容哈希、校验和、事务边界或文件级清单。
- 快照实体标签和值仍以字符串为主，没有完整类型系统。
- `playedCardsByPlayer` 是已观察历史，不等同于原始构筑卡表。
- 摘要是本机派生结果，没有签名，不适合作为跨系统权威凭据。

这些限制应在真实 Windows 日志验证后通过向后兼容的 schema 升级处理，不应直接改变既有 v1 文件含义。
