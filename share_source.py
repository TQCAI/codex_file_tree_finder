"""Create a source-only handoff ZIP from an explicit allowlist, never from a directory walk."""
import hashlib
import json
from pathlib import Path
import zipfile

BASE = Path(__file__).resolve().parent
FILES = [
    'AGENTS.md', 'README_FOR_AGENTS.md', '.gitignore', 'package.json',
    'patch.py', 'local_signing.py', 'install.py', 'install_after_quit.py',
    'smoke_startup.py', 'frontend_smoke.cjs', 'build_native_installer.py', 'share_source.py',
    'src/files.cjs', 'src/main.cjs', 'src/native.swift', 'src/preload.js', 'src/renderer.js', 'src/selection.js',
    'tests/files.test.cjs', 'tests/ipc.test.cjs', 'tests/native.test.cjs', 'tests/renderer.test.cjs', 'tests/selection.test.cjs',
]
ENTRY = '''# Codex File Tree Finder

为 macOS Codex 的**原生文件树**添加 Finder 式右键菜单和快捷键的实验性补丁。

支持复制/粘贴文件、移动、复制副本、重命名、新建文件/文件夹、移到废纸篓、快速预览、Finder 定位、ZIP 压缩、标签，以及部分撤销操作。保留原菜单。

`v0.1.4` 新增：**⌘⌥C 拷贝绝对路径，⌘⌥⇧C 拷贝相对工作区根目录的路径**；支持文件、文件夹、多选，并正确识别 macOS Option 组合键。

`v0.1.3` 修复：文字选区快捷键支持文件编辑器的可编辑节点、空白归一化和 Shadow DOM，优先在窗口捕获阶段处理；文件树 ⌘U 及右键菜单也支持文件夹引用。

`v0.1.2` 新增：文本预览中选中文字，按 **⌘U** 调用选区浮动按钮的原生“添加到对话”，保留原生上下文；仅在按钮可用时响应，排除输入框和编辑模式。

`v0.1.1` 新增：文件树选中文件后按 **⌘U**，调用原生“添加到对话”；支持多选；v0.1.3 起也支持文件夹引用，跳过聊天输入框。需要安装更新后生效。

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
'''

def build():
    entries = {'README.md': ENTRY.encode()}
    for name in FILES:
        path = BASE/name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Expected ordinary allowlisted source file: '+name)
        resolved = path.resolve()
        if BASE not in resolved.parents:
            raise ValueError('Source path escaped project: '+name)
        data = path.read_bytes()
        data.decode('utf-8')  # Fail closed for accidental binary artifacts.
        entries[name] = data
    manifest = {'format':1,'purpose':'source-only Codex agent handoff',
                'files':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(entries.items())}}
    entries['MANIFEST.json'] = (json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
    output = BASE/'dist/codex-finder-menu-source.zip'
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(entries.items()):
            item = zipfile.ZipInfo('codex-finder-menu/'+name)
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item,data)
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC validation failed')
        for name,expected in manifest['files'].items():
            if hashlib.sha256(archive.read('codex-finder-menu/'+name)).hexdigest() != expected:
                raise ValueError('ZIP manifest mismatch: '+name)
        if len(archive.namelist()) != len(entries):
            raise ValueError('Unexpected archive entry count')
    temporary.replace(output)
    print(json.dumps({'zip':str(output),'files':len(entries),'bytes':output.stat().st_size,
                      'sha256':hashlib.sha256(output.read_bytes()).hexdigest()},indent=2))

if __name__=='__main__': build()
