"""Prepare an isolated development copy; never changes the installed app."""
import hashlib
from pathlib import Path
import plistlib
import subprocess
import tempfile

BASE = Path(__file__).resolve().parent
ORIGINAL = Path('/Applications/ChatGPT.app')
SENTINEL = b'AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'

def dictionary_digest(info):
    integrity = info['ElectronAsarIntegrity']
    h = hashlib.sha256()
    for key in sorted(integrity):
        item = integrity[key]
        h.update((key + item['algorithm'] + item['hash']).encode())
    return h.digest()

def local_entitlements(app):
    p = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], capture_output=True, check=True)
    original = plistlib.loads(p.stdout)
    values = {k:v for k,v in original.items() if k.startswith('com.apple.security.') and k != 'com.apple.security.application-groups'}
    values['com.apple.security.cs.disable-library-validation'] = True
    return values

def sign(app, entitlements=None):
    command = ['codesign', '--force', '--sign', '-', '--options', 'runtime', '--timestamp=none']
    with tempfile.TemporaryDirectory() as folder:
        if entitlements is not None:
            path = Path(folder)/'entitlements.plist'
            path.write_bytes(plistlib.dumps(entitlements))
            command += ['--entitlements', str(path)]
        subprocess.run(command + [str(app)], check=True)

def prepare_test_copy():
    app = BASE/'signing-preflight/ChatGPT.app'
    if app.resolve() == ORIGINAL.resolve():
        raise ValueError('Test copy must be separate from installed application')
    relative = Path('Contents/Frameworks/Codex Framework.framework')
    framework = app/relative
    executable = framework/'Versions/Current/Codex Framework'
    original_info = plistlib.loads((ORIGINAL/'Contents/Info.plist').read_bytes())
    candidate_info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    data = bytearray(executable.read_bytes())
    if data.count(SENTINEL) != 1:
        raise ValueError('Expected exactly one framework integrity slot')
    start = data.index(SENTINEL)+len(SENTINEL)
    if data[start:start+2] != b'\x01\x01':
        raise ValueError('Integrity must remain enabled with supported version')
    old, new = dictionary_digest(original_info), dictionary_digest(candidate_info)
    if data[start+2:start+34] not in (old, new):
        raise ValueError('Original framework integrity digest mismatch')
    data[start+2:start+34] = new
    executable.write_bytes(data)
    helpers = Path('Versions/Current/Helpers')
    for helper in sorted((framework/helpers).glob('*.app')):
        reference = ORIGINAL/relative/helpers/helper.name
        sign(helper, local_entitlements(reference))
    sign(framework)
    sign(app, local_entitlements(ORIGINAL))
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    print('Development copy signed; ASAR validation remains enabled. Installed app unchanged.')

if __name__ == '__main__':
    prepare_test_copy()
