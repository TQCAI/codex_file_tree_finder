# Codex File Tree Finder

为 macOS Codex 的**原生文件树**添加 Finder 式右键菜单和快捷键的实验性补丁。

支持复制/粘贴文件、移动、复制副本、重命名、新建文件/文件夹、移到废纸篓、快速预览、Finder 定位、ZIP 压缩、标签，以及部分撤销操作。保留原菜单。

**这是非官方、固定版本的客户端补丁，不是即装即用的官方插件。**目前仅针对 macOS Apple Silicon 上的 `26.1013.40934` 做过独立副本验证，其他版本与架构需要重新适配。首次使用请让你的 Codex agent 阅读 [接手与安装指南](README_FOR_AGENTS.md)。

## 已知影响

- 客户端需要本地重签；**部分 Codex 内置工具已确认会因厂商签名身份丢失而拒绝连接**。
- 会移除原厂专属权限，为应用与 Electron helpers 设置应用级库验证例外；账号、钥匙串、通知与更新也可能受影响。
- 保留 ASAR 完整性校验和 hardened runtime，不关闭系统 Gatekeeper 或 SIP，不修改 Electron fuses。
- 只允许本机生成候选时指定的工作区。不是完整 Finder；真实菜单排版、全部快捷键和最终系统安装尚未完整验收。

## 源码验证

需要 macOS、Node.js 22+、Python 3.9+、Swift / Command Line Tools。

```sh
swiftc src/native.swift -o src/native-helper
npm test
```

测试通过不代表可以直接覆盖客户端。继续前请按指南核对应用版本、工作区、安全影响和备份恢复，再在本机生成候选并验证独立副本。

## 下载与交付

Release 中的 ZIP 仅包含源码、测试和文档，不包含官方客户端、安装包、账号、日志或本机授权记录。每台机器需要自行适配并重建。

运行 `python3 share_source.py` 可重新生成源码 ZIP；包内 `MANIFEST.json` 提供 SHA256 完整性清单，不是发布者数字签名。原作者的安装授权不适用于接收者。
