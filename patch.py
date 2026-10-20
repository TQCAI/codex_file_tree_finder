#!/usr/bin/env python3
"""Version-locked native menu patch. Default is read-only. Never bypasses ASAR integrity."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess

HERE = Path(__file__).resolve().parent
MARKER = b'/* codex-finder-menu v0.1.0 */'
TREE = 'webview/assets/base-file-tree-829fa47cd6d4.js'
BOOT = '.vite/build/early-bootstrap.js'
PRELOAD = '.vite/build/preload.js'
VERSION = '26.1013.40934'

def sha(data):
    return hashlib.sha256(data).hexdigest()

class Archive:
    def __init__(self, file):
        self.file = Path(file)
        with self.file.open('rb') as f:
            first = f.read(16)
            if len(first) != 16:
                raise ValueError('Invalid ASAR header')
            _, size, _, length = struct.unpack('<4I', first)
            self.raw_header = f.read(length)
            self.header = json.loads(self.raw_header)
            self.base = size + 8
    def entry(self, name):
        node = self.header
        for part in name.split('/'):
            node = node['files'][part]
        return node
    def read(self, name):
        e = self.entry(name)
        with self.file.open('rb') as f:
            f.seek(self.base + int(e['offset']))
            data = f.read(e['size'])
        integrity = e.get('integrity')
        if integrity and sha(data) != integrity['hash']:
            raise ValueError(f'Original file hash mismatch: {name}')
        return data
    def write(self, dest, replacements, additions):
        header = copy.deepcopy(self.header)
        for name, data in additions.items():
            node = header
            parts = name.split('/')
            for part in parts[:-1]:
                node = node['files'].setdefault(part, {'files': {}})
            if parts[-1] in node['files']:
                raise ValueError('Addition already exists: ' + name)
            node['files'][parts[-1]] = {'size': len(data)}
        chunks = []
        offset = 0
        def walk(node, prefix=''):
            nonlocal offset
            for key, e in node['files'].items():
                name = prefix + key
                if 'files' in e:
                    walk(e, name + '/')
                elif 'link' not in e and not e.get('unpacked'):
                    data = replacements.get(name, additions.get(name))
                    if data is not None:
                        block = e.get('integrity', {}).get('blockSize', 4194304)
                        e['size'] = len(data)
                        e['integrity'] = {'algorithm': 'SHA256', 'hash': sha(data), 'blockSize': block,
                                          'blocks': [sha(data[i:i + block]) for i in range(0, len(data), block)]}
                        chunks.append(('data', data, len(data)))
                    else:
                        chunks.append(('file', self.base + int(e['offset']), e['size']))
                    e['offset'] = str(offset)
                    offset += e['size']
        walk(header)
        raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
        padding = (-len(raw)) % 4
        pickle_size = 4 + len(raw) + padding
        packed = struct.pack('<4I', 4, pickle_size + 4, pickle_size, len(raw)) + raw + bytes(padding)
        with self.file.open('rb') as source, Path(dest).open('wb') as out:
            out.write(packed)
            for kind, data, size in chunks:
                if kind == 'data':
                    out.write(data)
                else:
                    source.seek(data)
                    while size:
                        buf = source.read(min(size, 8 * 1024 * 1024))
                        if not buf:
                            raise ValueError('Unexpected end of ASAR')
                        out.write(buf)
                        size -= len(buf)
        return sha(raw)

def once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Unsupported file tree build: expected exactly one patch anchor: ' + before[:90])
    return source.replace(before, after, 1)

def patches(archive, roots):
    package = json.loads(archive.read('package.json'))
    if package['version'] != VERSION:
        raise ValueError('Unsupported version: ' + package['version'])
    tree = archive.read(TREE).decode()
    if MARKER.decode() in tree:
        raise ValueError('Already patched')
    tree = 'import * as codexFinder from "./codex-finder-menu.js";\n' + tree
    tree = once(tree, 'return Oe({...We({scope:k,cwd:n,fallbackOpenTargets:j,hostId:d,targetPath:e})',
                'return codexFinder.menu(Oe({...We({scope:k,cwd:n,fallbackOpenTargets:j,hostId:d,targetPath:e})')
    ctx = '{path:e,cwd:n,hostId:d,model:J,directory:!!R.current?.endsWith(`/`),resolve:p=>je({cwd:n,isWindowsHost:A===`windows`,itemPath:p,targetPathByDisplayPath:F})}'
    tree = once(tree, 'targetPath:e})},t[90]=we', 'targetPath:e}),' + ctx + ')},t[90]=we')
    keyboard = '{cwd:n,hostId:d,model:J,resolve:p=>je({cwd:n,isWindowsHost:A===`windows`,itemPath:p,targetPathByDisplayPath:F})}'
    tree = once(tree, 'onClick:g,onContextMenu:Ct,onDoubleClick:_,model:J',
                'onClick:g,onContextMenu:Ct,onDoubleClick:_,onKeyDownCapture:e=>codexFinder.key(e,' + keyboard + '),model:J')
    changes = {
        TREE: MARKER + b'\n' + tree.encode(),
        BOOT: MARKER + b'\nrequire("./codex-finder-menu/main.cjs");\n' + archive.read(BOOT),
        PRELOAD: archive.read(PRELOAD) + b'\n' + MARKER + b'\n' + (HERE / 'src/preload.js').read_bytes(),
    }
    additions = {
        'webview/assets/codex-finder-menu.js': (HERE / 'src/renderer.js').read_bytes(),
        '.vite/build/codex-finder-menu/main.cjs': (HERE / 'src/main.cjs').read_bytes(),
        '.vite/build/codex-finder-menu/files.cjs': (HERE / 'src/files.cjs').read_bytes(),
        '.vite/build/codex-finder-menu/settings.json': json.dumps({'roots': roots}).encode(),
    }
    return changes, additions

def command(args):
    app = args.app.resolve()
    asar = app / 'Contents/Resources/app.asar'
    info = app / 'Contents/Info.plist'
    archive = Archive(asar)
    integrity = plistlib.loads(info.read_bytes()).get('ElectronAsarIntegrity', {}).get('Resources/app.asar', {})
    if integrity.get('hash') != sha(archive.raw_header):
        raise ValueError('Original ASAR header does not match Info.plist integrity; refusing to patch')
    roots = [str(p.expanduser().resolve(strict=True)) for p in args.root]
    changes, additions = patches(archive, roots)
    report = {'app': str(app), 'version': VERSION, 'roots': roots, 'changes': list(changes),
              'added': list(additions), 'originalHeaderSHA256': sha(archive.raw_header),
              'installRequires': ['Quit ChatGPT/Codex', 'Full app backup', 'Update ASAR hash in Info.plist',
                                  'Ad-hoc re-signing: changes publisher identity and may reset permissions/keychain access'],
              'runtimeVerified': False, 'installed': False}
    if args.command == 'check':
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return
    stage = args.output.resolve()
    stage.mkdir(parents=True, exist_ok=False)
    native = HERE / 'src/native-helper'
    if not native.is_file():
        subprocess.run(['swiftc', str(HERE / 'src/native.swift'), '-o', str(native)], check=True)
    # Check both patched renderer and native helpers before building a candidate archive.
    for name, data in changes.items():
        if name == TREE:
            candidate = stage / 'patched-tree.mjs'
            candidate.write_bytes(data)
            subprocess.run(['node', '--check', str(candidate)], check=True)
            candidate.unlink()
    digest = archive.write(stage / 'app.asar', changes, additions)
    parsed = Archive(stage / 'app.asar')
    for name, data in {**changes, **additions}.items():
        if parsed.read(name) != data:
            raise ValueError('Candidate archive failed readback: ' + name)
    patched_info = plistlib.loads(info.read_bytes())
    patched_info['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = digest
    (stage / 'Info.plist').write_bytes(plistlib.dumps(patched_info))
    helper = stage / 'app.asar.unpacked/.vite/build/codex-finder-menu/native-helper'
    helper.parent.mkdir(parents=True)
    shutil.copy2(native, helper)
    report['candidateHeaderSHA256'] = digest
    (stage / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'prepared': str(stage), 'installed': False, 'runtimeVerified': False}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'prepare'])
    parser.add_argument('--app', type=Path, default=Path('/Applications/ChatGPT.app'))
    parser.add_argument('--root', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, default=HERE / 'candidate')
    try:
        command(parser.parse_args())
    except Exception as e:
        raise SystemExit(str(e))
