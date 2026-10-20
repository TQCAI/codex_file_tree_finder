# Codex 原生文件树补丁：同事与 Codex agent 接手指南

## 先读结论

本项目为 macOS 上的 **Codex 原生文件树**添加 Finder 式右键菜单与快捷键。它是实验性客户端补丁，不是官方插件，也不是独立网页文件树。

交付的是源码，**不是可直接给所有人安装的成品**。当前仅适配原作者使用的应用版本 `26.1013.40934` 与对应编译模块。应用位置默认 `/Applications/ChatGPT.app`；不要根据应用名称猜测版本。其他版本或不同架构必须重新分析、适配并测试，不能删掉版本、锚点或完整性检查来强装。

原作者机器上，独立副本通过了启动、原生树模块加载、preload/IPC、新建文件夹、新建文件、重命名及复制副本测试；普通测试也覆盖了临时文件的废纸篓与恢复。真实右键菜单排版、全部快捷键、Finder 剪贴板互通，以及标准安装包的最终系统安装仍未完整验收。这些历史结果不能代替接收者机器上的验证。

## 已知影响：安装前向接收者说明

- 修改应用资源和框架摘要后，原厂签名不能保留，需要本地 ad-hoc 重签。
- 可启动方案移除了原厂应用身份、应用组、共享钥匙串及推送等专属权限；主程序及 Electron helpers 使用应用级 `disable-library-validation`，保留 hardened runtime。
- **已确认部分 Codex 桌面内置工具因 `missing-code-signing-identity` 拒绝连接。**账号、通知、钥匙串、自动更新及不同启动路径也可能受影响。不能承诺官方客户端的全部能力仍可用。
- 更新 Info.plist 与框架中的完整性摘要，保留 ASAR 校验启用状态；不关闭系统 Gatekeeper、SIP，不修改 Electron fuses。
- 同事自己的安装决定及系统授权必须由同事完成。原作者聊天中的安装授权不适用于另一台机器。检查、源码适配和生成候选包可以先做，覆盖正式客户端前再明确展示实际影响和恢复方案。

## 功能与边界

| 操作 | 文件树内快捷键 |
| --- | --- |
| 添加选中文件或目录引用到当前对话（支持多选） | ⌘U |
| 文本预览选区添加到对话（原生浮动按钮可用时） | ⌘U |
| 默认应用打开 / 快速预览 | ⌘O / 空格 |
| 文件简介（补丁对话框） | ⌘I |
| 拷贝 / 粘贴实际文件 | ⌘C / ⌘V |
| 将拷贝的项目移到此处 | ⌥⌘V |
| 拷贝绝对路径 | ⌥⌘C |
| 拷贝相对工作区根目录的路径 | ⇧⌥⌘C |
| 复制副本 | ⌘D |
| 重命名 | Return |
| 新建文件夹 / 文件 | ⇧⌘N / ⌥⇧⌘N |
| 移到废纸篓 | ⌘⌫，带确认 |
| 撤销最后一次移动、重命名或废纸篓操作 | ⌘Z |
| 在 Finder 中显示 / ZIP / macOS 标签 | 右键菜单 |

只响应本机文件树，排除编辑输入控件和远端工作区。保留原菜单；不覆盖同名文件，不允许操作工作区根目录、`.git` 内部或通过父目录符号链接越界。不包含全部 Finder 服务。标签操作替换现有标签；多项操作不是原子事务；撤销不是系统完整历史。

切换文件树的 `⌃⌘E` 属于原作者另行配置的 Codex 快捷键，不由本源码包自动设置。接收者需要时，再检查自己客户端支持的快捷键设置。

## 源码地图

| 文件 | 职责 |
| --- | --- |
| `src/renderer.js` | 原菜单增强、文件树局部快捷键、提示与对话框 |
| `src/selection.js` | 原生选区浮动按钮生命周期内的 ⌘U，复用原回调 |
| `src/preload.js` | 专用 IPC bridge |
| `src/main.cjs` | IPC 主框架校验、串行调度、确认、系统调用与撤销 |
| `src/files.cjs` | 允许目录、冲突与符号链接校验 |
| `src/native.swift` | 原生复制、移动、废纸篓、恢复、文件 URL 剪贴板和标签 |
| `patch.py` | 固定版本/模块锚点、候选 ASAR、逐文件哈希、Info.plist 摘要 |
| `local_signing.py` | 只在独立副本更新框架摘要并由内到外重签 |
| `smoke_startup.py` / `frontend_smoke.cjs` | 独立桌面 profile 的真实启动与前端 IPC 文件操作测试 |
| `build_native_installer.py` | 用本机已测试副本构建标准 macOS `.pkg`，不自动安装 |
| `install.py` | 直接安装/恢复工具；旧的简单重签路径会主动拒绝不兼容方案 |
| `install_after_quit.py` | 历史后台等待方案；原作者机器发生过系统拒绝写入，不是推荐安装入口 |
| `tests/` | 文件安全边界、菜单/键盘、IPC 与原生临时文件测试 |

## 接手流程

### 1. 先适配路径与版本，不运行历史安装器

需要 macOS、Node.js 22+、Python 3.9+、Swift 编译器/Command Line Tools，以及 macOS 打包工具。原副本是 Apple Silicon；不能假定 Intel 已通过验证。

在解压后的源码目录运行只读检查，例如：

```sh
node --version
python3 --version
swiftc --version
rg -n '/Users/|/Applications/|26\.1013\.40934|candidate-v2|signing-preflight' .
```

必须逐项核对：

1. `patch.py` 的 `VERSION`、`TREE`、`BOOT`、`PRELOAD` 及精确插入锚点，与接收者应用实际内容一致。
2. `patch.py --app` 可以指定应用，但 `local_signing.py`、`build_native_installer.py` 和生成的安装脚本还有固定应用路径。应用位置变化时要一致适配。
3. `frontend_smoke.cjs` 默认读取接收者自己生成的 `candidate-v2/report.json` 中第一个允许目录作为测试 `root`；也可用 `CODEX_FINDER_TEST_ROOT` 选择报告中已允许的其他目录。`build_native_installer.py` 的工作区说明同样来自本机候选报告，不包含原作者机器路径。
4. 其他脚本约定候选目录为 `candidate-v2`、副本目录为 `signing-preflight/ChatGPT.app`。改变命名时统一修改，避免拿错旧候选。
5. 不复用原作者机器的哈希、签名、测试报告、收据或安装包。所有派生结果均在接收者机器重新生成。

### 2. 运行源码测试、生成候选

先在源码目录设置自己机器的真实路径，下列占位符必须替换：

```sh
TASK_APP='/Applications/ChatGPT.app'
TASK_WORKSPACE='/absolute/path/to/colleague/workspace'
swiftc src/native.swift -o src/native-helper
npm test
python3 patch.py check --app "$TASK_APP" --root "$TASK_WORKSPACE"
python3 patch.py prepare --app "$TASK_APP" --root "$TASK_WORKSPACE" --output ./candidate-v2
```

`prepare` 的输出目录必须尚不存在，可重复 `--root` 加入多个明确允许的工作区。`settings.json` 在候选 ASAR 内生成，不能仅修改桌面 profile 来改变允许范围。测试不需要 npm 第三方依赖；原生测试会操作它自己创建的临时文件及其废纸篓项目。

已经安装已知 `v0.1.0` 或 `v0.1.2` 文件树补丁的同版本客户端，可用 `python3 patch.py upgrade --app "$TASK_APP" --root "$TASK_WORKSPACE" --output ./candidate-v2` 生成 `v0.1.4` 的文件与文字选区 ⌘U、路径快捷键更新候选。必须按原顺序列出原有全部允许目录；升级不会更改目录权限。它替换文件树模块、选区浮动按钮模块及快捷键 renderer，保留当前 main/preload 和 native helper。仍需复制客户端、同步摘要、重签、实测并通过系统安装器覆盖后才生效。

### 3. 准备独立副本并实测

确认脚本已适配实际应用位置，且 `signing-preflight/ChatGPT.app` 尚不存在。下面只创建副本，不覆盖正式应用：

```sh
mkdir -p signing-preflight
ditto "$TASK_APP" ./signing-preflight/ChatGPT.app
python3 - <<'PY'
from pathlib import Path
import shutil
source = Path('candidate-v2')
target = Path('signing-preflight/ChatGPT.app/Contents')
shutil.copy2(source/'app.asar', target/'Resources/app.asar')
shutil.copy2(source/'Info.plist', target/'Info.plist')
shutil.copytree(source/'app.asar.unpacked', target/'Resources/app.asar.unpacked', dirs_exist_ok=True)
PY
python3 local_signing.py
python3 smoke_startup.py
```

`local_signing.py` 校验框架摘要 sentinel、版本和原摘要，再仅更新摘要；不能跳过这些检查。真实启动测试临时启用回环调试端口，结束后应确认测试进程和端口均关闭。

**独立桌面 profile 不等于完全隔离账号或后端状态。**测试可能访问同一台机器的 Codex 后端与账号，日志可能包含会话标识。接收者应知道这一点，并检查测试仅在允许的临时目录执行，不发送聊天消息。

检查新生成的 `full-startup-result.json`：进程运行、主窗口加载、`frontendTest.exit == 0`，且 CodeHash 与实际测试副本一致。还要人工检查右键菜单、快捷键、剪贴板互通及文件监控刷新；不能仅凭签名校验通过就说“可正常使用”。

### 4. 安装、验证与恢复

展示本机测试结果与前述已知影响，接收者明确决定继续后，优先生成标准安装包：

```sh
python3 build_native_installer.py
```

生成的 `.pkg` 仅供这台机器经过检查的客户端与工作区使用。先核对生成脚本和安装包内容；打开系统安装器后，保留安装器窗口，用 ⌘Q 正常退出 Codex，再继续安装并完成系统管理员授权。不要在后台等待脚本和系统安装器之间并行安装。

历史经验：原作者的 LaunchAgent 能读应用，但覆盖时被系统以 `Operation not permitted` 拒绝，导致无法自动重开。不要只让接收者反复退出，也不要关闭系统保护来解决权限问题。图形控制不可用时，应让本人操作系统安装器和授权窗口。

标准包会在 `/Library/Application Support/CodexFinderMenu/<本次构建编号>/Original.app` 保存受管理员保护的原版；版本、哈希、签名或启动检查失败时，在应用已停止的条件下尝试恢复。该回滚不能替代接收者自己保留的备份。另有 `install.py restore --receipt <本机收据>` 用于直接安装流程的恢复；需要正常退出应用和合法写入权限，不能套用另一台机器的收据。

安装后核对正式应用的 ASAR 哈希、CodeHash、运行状态，再在临时文件上验收操作。若应用已自动更新或另行修改，停止使用旧候选和旧备份覆盖，先重新检查。

## 分享与保密

源码 ZIP 采用明确白名单：源码、构建/测试脚本、测试、文档和清单。**不包含**官方客户端及框架、`.pkg`、原生编译产物、候选包、完整备份、账号/profile、运行日志、会话数据、本机收据、调试端口文件或历史授权记录。源码中仍有待适配的机器路径，见上面的检查列表；它们不是接收者机器的默认配置。

运行 `python3 share_source.py` 可以重新生成 `dist/codex-finder-menu-source.zip`。包内 `MANIFEST.json` 记录每个交付文件的 SHA256；这是完整性清单，不是发布者数字签名。

## v0.1.3 选区修复

原生文件编辑器可能使用 contenteditable 或 Shadow DOM，原生 selectedText 也可能经过 trim/序列化。不要用 window.getSelection().toString() 的严格相等来判断原生选区是否有效，也不要把文件编辑器一律当成聊天输入框排除。快捷键绑定随原生选区浮动按钮挂载/卸载，调用该按钮已有的回调。只添加目录引用，不递归附加目录中的文件。独立副本测试包含 Chromium Input.dispatchKeyEvent 的真实输入分发、文件编辑节点与 Shadow DOM，但最终用户对话仍需安装后验收。

## v0.1.4 路径快捷键

文件树的 Finder 菜单提供 ⌥⌘C 绝对路径、⇧⌥⌘C 相对当前工作区根目录路径，支持文件夹和多选（每行一个路径）。根目录自身复制为 `.`。这是 Codex 文件树中的增强；不修改系统 Finder。Option 可能令 event.key 产生特殊字符，因此 Command 组合键使用 event.code 识别字母键。
