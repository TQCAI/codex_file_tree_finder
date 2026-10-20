#!/usr/bin/env python3
"""Explicit opt-in installer / full-bundle restore; refuses a running app."""
import argparse
from datetime import datetime
import json
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys
from patch import Archive, sha

BASE = Path(__file__).resolve().parent

def run(*args):
    subprocess.run(list(map(str, args)), check=True)

def stopped(app):
    commands = subprocess.check_output(['ps', '-axo', 'comm='], text=True).splitlines()
    executable = str(app / 'Contents/MacOS/ChatGPT')
    if any(c.strip() == executable for c in commands):
        raise ValueError('请先正常退出 ChatGPT/Codex。安装器不会强制结束正在运行的任务。')

def signing_preflight(app):
    metadata = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)],
                              capture_output=True, text=True, check=True).stderr
    entitlements = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)],
                                  capture_output=True, check=True).stdout
    values = plistlib.loads(entitlements)
    if '(runtime)' in metadata and not values.get('com.apple.security.cs.disable-library-validation'):
        raise ValueError('安装已阻止：原应用启用 hardened runtime 与库验证；当前 ad-hoc 重签方案无法保留厂商 Team ID，且尚未通过真实启动验证。正式应用未修改。')

def install(args):
    stage = args.candidate.resolve()
    report = json.loads((stage / 'report.json').read_text())
    app = Path(report['app'])
    signing_preflight(app)
    stopped(app)
    if not args.acknowledge_ad_hoc_signing:
        raise ValueError('需要先了解重新签名对更新、权限及钥匙串的影响，再使用 --acknowledge-ad-hoc-signing。')
    archive = Archive(app / 'Contents/Resources/app.asar')
    candidate = Archive(stage / 'app.asar')
    if sha(archive.raw_header) != report['originalHeaderSHA256']:
        raise ValueError('应用已更新或修改；请重新生成补丁。')
    if sha(candidate.raw_header) != report['candidateHeaderSHA256']:
        raise ValueError('候选补丁完整性校验失败。')
    run('codesign', '--verify', '--deep', '--strict', app)
    backup = BASE / 'backups' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '.app')
    backup.parent.mkdir(exist_ok=True)
    run('/usr/bin/ditto', app, backup)
    receipt = {'app': str(app), 'backup': str(backup), 'state': 'backup-created', 'candidate': str(stage)}
    receipt_path = backup.parent / (backup.name + '.json')
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    try:
        shutil.copy2(stage / 'app.asar', app / 'Contents/Resources/app.asar')
        shutil.copy2(stage / 'Info.plist', app / 'Contents/Info.plist')
        shutil.copytree(stage / 'app.asar.unpacked', app / 'Contents/Resources/app.asar.unpacked', dirs_exist_ok=True)
        helper = app / 'Contents/Resources/app.asar.unpacked/.vite/build/codex-finder-menu/native-helper'
        run('codesign', '--force', '--sign', '-', '--timestamp=none', helper)
        # Retain hardened runtime and entitlements. Do not alter fuses or disable Gatekeeper.
        run('codesign', '--force', '--sign', '-', '--options', 'runtime', '--preserve-metadata=identifier,entitlements', '--timestamp=none', app)
        run('codesign', '--verify', '--deep', '--strict', app)
        receipt['state'] = 'installed-unverified-runtime'
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
    except Exception:
        print('安装失败，正在恢复完整原应用包。', file=sys.stderr)
        # ditto replaces changed files; remove only the files introduced by this patch.
        added = app / 'Contents/Resources/app.asar.unpacked/.vite/build/codex-finder-menu'
        if added.is_dir(): shutil.rmtree(added)
        run('/usr/bin/ditto', backup, app)
        run('codesign', '--verify', '--deep', '--strict', app)
        raise

def install_local(args):
    """Install only a development bundle that passed the recorded real startup test."""
    if not args.acknowledge_local_permissions:
        raise ValueError('需明确接受：移除原厂专属权限、应用及 Electron helpers 使用库验证例外、部分内置工具因签名身份丢失而不可用。')
    stage = BASE/'signing-preflight/ChatGPT.app'
    evidence = json.loads((stage.parent/'full-startup-result.json').read_text())
    if not evidence.get('aliveAfter20s') or evidence.get('frontendTest',{}).get('exit') != 0:
        raise ValueError('候选副本未通过真实启动及前端 IPC 测试。')
    metadata = subprocess.run(['codesign','-dv','--verbose=4',str(stage)],capture_output=True,text=True,check=True).stderr
    code_hash = next(line.split('=',1)[1] for line in metadata.splitlines() if line.startswith('CDHash='))
    if code_hash != evidence.get('codeHash'):
        raise ValueError('候选副本签名与已测试版本不符。')
    candidate = BASE/'candidate-v2'
    report = json.loads((candidate/'report.json').read_text())
    app = Path(report['app'])
    if sha(Archive(app/'Contents/Resources/app.asar').raw_header) != report['originalHeaderSHA256']:
        raise ValueError('正式应用已更新或修改；拒绝覆盖。')
    if sha(Archive(stage/'Contents/Resources/app.asar').raw_header) != report['candidateHeaderSHA256']:
        raise ValueError('候选应用 ASAR 不匹配。')
    run('codesign','--verify','--deep','--strict',app)
    run('codesign','--verify','--deep','--strict',stage)
    stopped(app)
    if args.backup_receipt:
        receipt_path = args.backup_receipt.resolve()
        receipt = json.loads(receipt_path.read_text())
        backup = Path(receipt['backup'])
        if receipt.get('app') != str(app) or receipt.get('state') != 'backup-created':
            raise ValueError('预先备份收据不匹配或已使用。')
        run('codesign','--verify','--deep','--strict',backup)
        if sha(Archive(backup/'Contents/Resources/app.asar').raw_header) != report['originalHeaderSHA256']:
            raise ValueError('备份不是当前原厂版本。')
        receipt.update(mode='local-permissions',testedCodeHash=code_hash)
    else:
        backup = BASE/'backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'.app')
        backup.parent.mkdir(exist_ok=True)
        run('/usr/bin/ditto',app,backup)
        run('codesign','--verify','--deep','--strict',backup)
        receipt = {'app':str(app),'backup':str(backup),'candidate':str(candidate),'state':'backup-created','mode':'local-permissions','testedCodeHash':code_hash}
        receipt_path = backup.parent/(backup.name+'.json')
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
    try:
        run('/usr/bin/ditto',stage,app)
        run('codesign','--verify','--deep','--strict',app)
        receipt['state'] = 'installed-awaiting-user-restart'
        receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps(receipt,indent=2))
    except Exception:
        added = app/'Contents/Resources/app.asar.unpacked/.vite/build/codex-finder-menu'
        if added.is_dir(): shutil.rmtree(added)
        run('/usr/bin/ditto',backup,app)
        run('codesign','--verify','--deep','--strict',app)
        raise

def restore(args):
    receipt = json.loads(args.receipt.read_text())
    app, backup = Path(receipt['app']), Path(receipt['backup'])
    stopped(app)
    if not backup.is_dir(): raise ValueError('完整备份不存在')
    run('codesign', '--verify', '--deep', '--strict', backup)
    original = Archive(backup / 'Contents/Resources/app.asar')
    current = Archive(app / 'Contents/Resources/app.asar')
    candidate = Archive(Path(receipt['candidate']) / 'app.asar')
    if sha(current.raw_header) not in [sha(candidate.raw_header), sha(original.raw_header)]:
        raise ValueError('应用已更新或另行修改；拒绝用旧备份覆盖，请手动检查。')
    added = app / 'Contents/Resources/app.asar.unpacked/.vite/build/codex-finder-menu'
    if added.is_dir(): shutil.rmtree(added)
    run('/usr/bin/ditto', backup, app)
    run('codesign', '--verify', '--deep', '--strict', app)
    print('已恢复完整原应用包及原签名。备份仍保留。')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('apply')
    p.add_argument('--candidate', type=Path, default=BASE / 'candidate-v2')
    p.add_argument('--acknowledge-ad-hoc-signing', action='store_true')
    p = sub.add_parser('apply-local')
    p.add_argument('--acknowledge-local-permissions',action='store_true')
    p.add_argument('--backup-receipt',type=Path)
    p = sub.add_parser('restore')
    p.add_argument('--receipt', type=Path, required=True)
    try:
        args = parser.parse_args()
        {'apply':install,'apply-local':install_local,'restore':restore}[args.command](args)
    except Exception as e:
        raise SystemExit(str(e))
