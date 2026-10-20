"""Build a normal macOS Installer package; this does not install it."""
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import html
import json
from pathlib import Path
import plistlib
import subprocess

BASE = Path(__file__).resolve().parent
WORK = BASE/'native-package'
APP = Path('/Applications/ChatGPT.app')
STAGE = BASE/'signing-preflight/ChatGPT.app'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def run(*args):
    subprocess.run([str(a) for a in args],check=True)

def main():
    WORK.mkdir(exist_ok=True)
    for app in (APP,STAGE): run('/usr/bin/codesign','--verify','--deep','--strict',app)
    evidence=json.loads((STAGE.parent/'full-startup-result.json').read_text())
    metadata=subprocess.run(['/usr/bin/codesign','-dv','--verbose=4',str(STAGE)],capture_output=True,text=True,check=True).stderr
    codehash=next(line.split('=',1)[1] for line in metadata.splitlines() if line.startswith('CDHash='))
    if not evidence.get('aliveAfter20s') or evidence.get('frontendTest',{}).get('exit') != 0 or codehash != evidence.get('codeHash'):
        raise ValueError('Candidate must match the successful real startup and IPC test')
    original=digest(APP/'Contents/Resources/app.asar')
    candidate=digest(STAGE/'Contents/Resources/app.asar')
    candidate_report=json.loads((BASE/'candidate-v2/report.json').read_text())
    workspace_description=html.escape('、'.join(candidate_report['roots']))
    build_id=datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d-%H%M%S')
    store='/Library/Application Support/CodexFinderMenu/'+build_id
    scripts=WORK/'scripts';scripts.mkdir(exist_ok=True)
    pre=r'''#!/bin/zsh
set -eu
TASK_APP='/Applications/ChatGPT.app'
TASK_STORE='@STORE@'
TASK_ORIGINAL='@ORIGINAL@'
if [[ "${1:-}" != '--verify-only' ]]; then
  if [[ $EUID -ne 0 ]]; then echo '请通过 macOS 安装器运行此安装包。'; exit 1; fi
  if /bin/ps -axo comm= | /usr/bin/awk -v target="$TASK_APP/Contents/MacOS/ChatGPT" '{sub(/^[[:space:]]+/,""); if($0==target) found=1} END{exit !found}'; then
    echo 'Codex 仍在运行。请先用 ⌘Q 正常退出，再重试安装；应用未修改。'; exit 1
  fi
fi
/usr/bin/codesign --verify --deep --strict "$TASK_APP"
TASK_HASH=$(/usr/bin/shasum -a 256 "$TASK_APP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
if [[ "$TASK_HASH" != "$TASK_ORIGINAL" ]]; then echo '当前应用与已验证原版不符，拒绝覆盖。'; exit 1; fi
if [[ "${1:-}" == '--verify-only' ]]; then echo 'READONLY PREFLIGHT PASSED: original signature and full ASAR hash match.'; exit 0; fi
/usr/bin/install -d -o root -g wheel -m 755 '/Library/Application Support/CodexFinderMenu'
/usr/bin/install -d -o root -g wheel -m 700 "$TASK_STORE"
if [[ ! -d "$TASK_STORE/Original.app" ]]; then /usr/bin/ditto "$TASK_APP" "$TASK_STORE/Original.app"; fi
/usr/bin/codesign --verify --deep --strict "$TASK_STORE/Original.app"
TASK_HASH=$(/usr/bin/shasum -a 256 "$TASK_STORE/Original.app/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
if [[ "$TASK_HASH" != "$TASK_ORIGINAL" ]]; then echo '备份校验失败，停止安装。'; exit 1; fi
/usr/bin/stat -f %u /dev/console > "$TASK_STORE/console-uid"
echo 'Original backup verified. Installer may now replace the application.'
'''
    post=r'''#!/bin/zsh
set -eu
TASK_APP='/Applications/ChatGPT.app'
TASK_STORE='@STORE@'
TASK_CANDIDATE='@CANDIDATE@'
TASK_CODEHASH='@CODEHASH@'
TASK_UID=$(/bin/cat "$TASK_STORE/console-uid")
task_open() {
  if [[ "$TASK_UID" -gt 0 ]]; then
    /bin/launchctl asuser "$TASK_UID" /usr/bin/sudo -H -u "#$TASK_UID" /usr/bin/open -a "$TASK_APP"
  else
    return 1
  fi
}
task_running() {
  /bin/ps -axo comm= | /usr/bin/awk -v target="$TASK_APP/Contents/MacOS/ChatGPT" '{sub(/^[[:space:]]+/,""); if($0==target) found=1} END{exit !found}'
}
task_restore() {
  trap - ZERR
  if task_running; then
    echo '安装后检查失败，但应用仍在运行；未强制关闭。请正常退出后使用原厂备份恢复。'
    echo 'failed-app-running' > "$TASK_STORE/status.txt"
    exit 1
  fi
  /bin/rm -rf -- "$TASK_APP/Contents/Resources/app.asar.unpacked/.vite/build/codex-finder-menu"
  /usr/bin/ditto "$TASK_STORE/Original.app" "$TASK_APP"
  /usr/bin/codesign --verify --deep --strict "$TASK_APP"
  echo 'restored-original' > "$TASK_STORE/status.txt"
  echo '安装或启动检查失败，已恢复原厂应用及签名。'
  task_open || true
  exit 1
}
trap task_restore ZERR
/usr/bin/codesign --verify --deep --strict "$TASK_APP"
TASK_HASH=$(/usr/bin/shasum -a 256 "$TASK_APP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
[[ "$TASK_HASH" == "$TASK_CANDIDATE" ]]
TASK_ACTUAL=$(/usr/bin/codesign -dv --verbose=4 "$TASK_APP" 2>&1 | /usr/bin/awk -F= '/^CDHash=/{print $2}')
[[ "$TASK_ACTUAL" == "$TASK_CODEHASH" ]]
echo 'installed-signature-verified' > "$TASK_STORE/status.txt"
task_open
TASK_SEEN=0
for TASK_INDEX in {1..45}; do
  if task_running; then TASK_SEEN=1; break; fi
  /bin/sleep 1
done
[[ "$TASK_SEEN" == 1 ]]
for TASK_INDEX in {1..20}; do /bin/sleep 1; task_running; done
echo 'installed-started' > "$TASK_STORE/status.txt"
echo '补丁已安装，签名及完整文件哈希通过，Codex 已重新打开并持续运行 20 秒。'
'''
    for name,source in [('preinstall',pre),('postinstall',post)]:
        for key,value in {'STORE':store,'ORIGINAL':original,'CANDIDATE':candidate,'CODEHASH':codehash}.items(): source=source.replace('@'+key+'@',value)
        target=scripts/name;target.write_text(source);target.chmod(0o755)
        run('/bin/zsh','-n',target)
    run('/bin/zsh',scripts/'preinstall','--verify-only')
    payload=WORK/'payload';payload.mkdir(exist_ok=True)
    run('/usr/bin/ditto',STAGE,payload/'ChatGPT.app')
    run('/usr/bin/codesign','--verify','--deep','--strict',payload/'ChatGPT.app')
    components=WORK/'components.plist'
    run('/usr/bin/pkgbuild','--analyze','--root',payload,components)
    values=plistlib.loads(components.read_bytes())
    if len(values)!=1 or values[0]['RootRelativeBundlePath']!='ChatGPT.app': raise ValueError('Unexpected component layout')
    values[0].update(BundleIsRelocatable=False,BundleIsVersionChecked=False,BundleHasStrictIdentifier=True,BundleOverwriteAction='upgrade')
    components.write_bytes(plistlib.dumps(values))
    identifier='local.codex-finder-menu.native'
    run('/usr/bin/pkgbuild','--root',payload,'--component-plist',components,'--scripts',scripts,'--identifier',identifier,'--version','0.1.0','--install-location','/Applications','--ownership','preserve',WORK/'CodexFinderMenu-component.pkg')
    resources=WORK/'resources';resources.mkdir(exist_ok=True)
    (resources/'welcome.html').write_text('''<html><meta charset="utf-8"><body><h2>Codex 原生文件树增强（非官方）</h2><p>先保持此安装窗口打开，用 ⌘Q 正常退出 Codex，再返回本窗口继续安装。系统安装器会请求 macOS 管理员授权。</p><p>安装后会尝试自动重新打开；请勿手动提前启动。</p><p>此包固定适配 26.1013.40934，允许的工作区：@WORKSPACES@。</p><p><strong>已知影响：</strong>改用本地签名、移除原厂专属权限，并为应用及 Electron helpers 设置库验证例外；部分 Codex 内置工具已确认会被拒绝连接，钥匙串、通知、更新也可能受影响。首版不是完整 Finder。</p><p>安装前会验证原厂版本并保存完整备份。签名或启动检查失败时，会在应用已停止的条件下尝试恢复原版；不会关闭系统 Gatekeeper、SIP 或强制结束应用。</p></body></html>'''.replace('@WORKSPACES@', workspace_description))
    (resources/'conclusion.html').write_text('''<html><meta charset="utf-8"><body><h2>安装完成</h2><p>Codex 应已重新打开。请在原生文件树里对临时文件右键，验收重命名、新建、复制和移到废纸篓等功能。</p><p>快捷键：Return 重命名，⌘⌫ 移到废纸篓，⌘C/⌘V 复制粘贴，⌘D 复制副本，⇧⌘N 新建文件夹。⌃⌘E 切换文件树。</p><p>原厂备份由管理员保护，位于 /Library/Application Support/CodexFinderMenu。用户目录下原有备份也继续保留。</p></body></html>''')
    distribution=WORK/'distribution.xml'
    distribution.write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
<title>Codex 原生文件树增强</title><welcome file="welcome.html"/><conclusion file="conclusion.html"/>
<options customize="never" require-scripts="true" hostArchitectures="arm64"/>
<domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
<choices-outline><line choice="default"><line choice="payload"/></line></choices-outline>
<choice id="default"/><choice id="payload" visible="false"><pkg-ref id="{identifier}"/></choice>
<pkg-ref id="{identifier}" version="0.1.0" auth="Root">CodexFinderMenu-component.pkg</pkg-ref>
</installer-gui-script>''')
    output=BASE/'Codex原生文件树增强.pkg'
    run('/usr/bin/productbuild','--distribution',distribution,'--package-path',WORK,'--resources',resources,output)
    (WORK/'build-report.json').write_text(json.dumps({'package':str(output),'originalFullAsarSHA256':original,'candidateFullAsarSHA256':candidate,'candidateCodeHash':codehash,'rootBackup':store+'/Original.app','builtAt':build_id},indent=2)+'\n')
    print('BUILT:',output)

if __name__=='__main__': main()
