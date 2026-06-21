# M3U Mixer

桌面版 M3U 音视频混流控制台。用户可录入多个 M3U 订阅，分别选择视频频道组和音频频道组，预览、手动调整视频延迟，并输出本地 HLS `m3u8` 地址供其他播放器访问。

## Stack

- Electron + React + TypeScript
- Node service in Electron main process
- better-sqlite3 persistence
- ffmpeg / ffprobe probing and HLS output

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Release

```bash
git tag v0.1.0
git push origin v0.1.0
```

- GitHub Actions workflow: `.github/workflows/release.yml`
- 触发方式：推送 `v*` tag 或手动执行 `workflow_dispatch`
- 发布产物：Windows `NSIS`、macOS `DMG + ZIP`、Linux `AppImage`
- 发布依赖：仓库需要启用 GitHub Actions，使用内置 `GITHUB_TOKEN` 创建/更新 Release

## Notes

- 需要系统可用的 `ffmpeg` 和 `ffprobe`。
- 默认公共输出地址为 `http://127.0.0.1:18999/live/main.m3u8`。
- 预览 HLS 服务固定在 `http://127.0.0.1:18998/preview/...`。
