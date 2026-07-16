# 协作约定

项目目前处于设计阶段。本文件约定 Git 使用方式，具体构建、测试命令将在技术栈确定后补充。

## 本机身份

提交前确认仓库使用的是你自己的身份：

```bash
git config --local user.name "你的名字"
git config --local user.email "你的邮箱"
git config --local --get-regexp '^user\\.'
```

不要把 API Key、Battle.net 账号信息、原始对局截图或包含个人信息的日志提交到仓库。

## 分支与提交

- 当前远端默认分支沿用 `master`，未经仓库所有者确认不改名。
- 功能分支使用 `feature/<topic>`，修复分支使用 `fix/<topic>`，文档分支使用 `docs/<topic>`。
- 提交信息采用 Conventional Commits，例如 `docs: add state model`、`feat: parse game events`。
- 一个提交只处理一个清晰目标，不混入格式化或无关文件。
- 不重写已经推送并被他人使用的公共历史。

## 数据与样本

- 运行数据放入 `data/`、`runtime/`、`captures/` 或 `logs/`，这些目录默认忽略。
- 可公开且已经脱敏的最小测试样本放入 `tests/fixtures/`。
- 大型卡牌数据快照、模型文件和原始录像不直接进入 Git；后续通过下载脚本、对象存储或 Release 管理。
- 测试样本必须记录游戏版本、模式、语言和数据来源。

## 合并前检查

- 变更符合当前设计文档和安全边界。
- 没有提交密钥、用户隐私数据或机器专属路径。
- 新行为具有相应测试或可复现样本。
- 文档链接有效，重要设计变化同步记录。
