"""One-shot, user-authorized installer. Waits for normal quit; never kills the app."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime

BASE = Path(__file__).resolve().parent
STATUS = BASE/'安装状态.txt'
STATE = BASE/'install-status.json'

def status(state, message, **extra):
    value = {'state':state,'message':message,'updatedAt':datetime.now().isoformat(),**extra}
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    temp.replace(STATE)
    STATUS.write_text(message+'\n\n'+json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(message,flush=True)

def running(app):
    commands = subprocess.check_output(['/bin/ps','-axo','comm='],text=True).splitlines()
    executable = str(app/'Contents/MacOS/ChatGPT')
    return any(command.strip()==executable for command in commands)

def restore(receipt, app):
    if running(app):
        status('failed-needs-manual-restore','安装或启动检查失败，但应用仍在运行。请正常退出后运行“恢复原版.command”。',receipt=str(receipt))
        return
    result = subprocess.run([sys.executable,str(BASE/'install.py'),'restore','--receipt',str(receipt)],cwd=BASE)
    if result.returncode:
        status('restore-failed','自动恢复失败。请保留备份并查看 install-after-quit.log。',receipt=str(receipt))
        return
    status('restored','补丁安装或启动失败，已恢复原厂应用及签名。',receipt=str(receipt))
    subprocess.run(['/usr/bin/open','-a',str(app)],timeout=15)

def original_unchanged(receipt, app):
    data = json.loads(receipt.read_text())
    if data.get('state') != 'backup-created':
        return False
    hashes = []
    for target in (app,Path(data['backup'])):
        verified = subprocess.run(['codesign','--verify','--deep','--strict',str(target)],capture_output=True)
        if verified.returncode:
            return False
        metadata = subprocess.run(['codesign','-dv','--verbose=4',str(target)],capture_output=True,text=True,check=True).stderr
        hashes.append(next(line for line in metadata.splitlines() if line.startswith('CDHash=')))
    return hashes[0] == hashes[1]

def wait_then_install(receipt, app, deadline):
    while time.monotonic()<deadline:
        consecutive = 0
        while time.monotonic()<deadline:
            consecutive = 0 if running(app) else consecutive+1
            if consecutive>=3:
                break
            time.sleep(2)
        else:
            break
        status('installing','正在覆盖安装已测试副本，请勿手动打开 Codex；完成后会自动打开。',receipt=str(receipt))
        result = subprocess.run([sys.executable,str(BASE/'install.py'),'apply-local','--acknowledge-local-permissions','--backup-receipt',str(receipt)],cwd=BASE,capture_output=True,text=True)
        print(result.stdout or '',end='',flush=True)
        print(result.stderr or '',end='',flush=True)
        if result.returncode == 0:
            return True
        untouched = original_unchanged(receipt,app)
        if untouched and '请先正常退出 ChatGPT/Codex' in (result.stdout or '')+(result.stderr or ''):
            status('waiting-for-normal-quit','检测到 Codex 在替换前已重新打开，原版未修改。继续等待正常退出；请勿手动重开，安装完成会自动打开。',receipt=str(receipt))
            time.sleep(2)
            continue
        if untouched:
            status('failed-original-unchanged','安装预检失败，原厂应用未修改，无需恢复。请查看 install-after-quit.log。',receipt=str(receipt))
        else:
            restore(receipt,app)
        return False
    status('expired','等待退出已超过 1 小时，安装已取消，未执行覆盖。',receipt=str(receipt))
    return False

def main():
    receipt = Path(sys.argv[1]).resolve()
    data = json.loads(receipt.read_text())
    app = Path(data['app'])
    lock = (BASE/'install-once.lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    status('waiting-for-normal-quit','完整原厂备份已验证。请用 ⌘Q 正常退出 Codex；退出后自动覆盖安装并重新打开。此一次性等待最多保留 1 小时。',receipt=str(receipt))
    deadline = time.monotonic()+3600
    if not wait_then_install(receipt,app,deadline):
        return
    try:
        version = subprocess.run([str(app/'Contents/MacOS/ChatGPT'),'--version'],capture_output=True,text=True,timeout=15)
        if version.returncode:
            raise RuntimeError('Installed executable version check failed')
        status('reopening','已完成覆盖及签名校验，正在重新打开并检查进程。',receipt=str(receipt),version=version.stdout.strip())
        opened = subprocess.run(['/usr/bin/open','-a',str(app)],timeout=15)
        if opened.returncode:
            raise RuntimeError('macOS refused to open the application')
        for _ in range(45):
            if running(app):
                break
            time.sleep(1)
        else:
            raise RuntimeError('Application did not start within 45 seconds')
        for _ in range(20):
            time.sleep(1)
            if not running(app):
                raise RuntimeError('Application exited during startup check')
        status('installed-started','原生文件树补丁已覆盖安装，签名与版本检查通过，应用已重新打开并持续运行 20 秒。右键菜单与快捷键可开始人工验收。',receipt=str(receipt),version=version.stdout.strip())
    except Exception as error:
        print(str(error),flush=True)
        restore(receipt,app)

if __name__=='__main__':
    main()
