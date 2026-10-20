"""Launch ONLY the development copy with a separate desktop profile, then stop it."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

base = Path(__file__).resolve().parent
folder = base/'signing-preflight'
profile = base/'runtime-test-profile'
env = os.environ.copy()
env['CODEX_ELECTRON_USER_DATA_PATH'] = str(profile)
port_file = profile/'DevToolsActivePort'
port_file.unlink(missing_ok=True)
with (folder/'full-startup.log').open('w') as log:
    process = subprocess.Popen([str(folder/'ChatGPT.app/Contents/MacOS/ChatGPT'),
        '--user-data-dir='+str(profile), '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0', '--no-first-run'], env=env, stdout=log,
        stderr=subprocess.STDOUT, start_new_session=True)
    try:
        for _ in range(20):
            if process.poll() is not None:
                break
            time.sleep(1)
        result = {'aliveAfter20s': process.poll() is None, 'exit': process.poll(), 'targets': []}
        if port_file.exists() and process.poll() is None:
            port = int(port_file.read_text().splitlines()[0])
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list',timeout=3) as response:
                targets = json.load(response)
                result['targets'] = [{k:item.get(k) for k in ['type','url','title']} for item in targets]
            result['debugPort'] = port
            target = next((t for t in targets if t.get('url') == 'app://-/index.html'),None)
            if target:
                test = subprocess.run(['node',str(base/'frontend_smoke.cjs'),target['webSocketDebuggerUrl']], capture_output=True,text=True,timeout=20)
                result['frontendTest'] = {'exit':test.returncode,'stdout':test.stdout,'stderr':test.stderr}
            metadata = subprocess.run(['codesign','-dv','--verbose=4',str(folder/'ChatGPT.app')],capture_output=True,text=True,check=True)
            result['codeHash'] = next(line.split('=',1)[1] for line in metadata.stderr.splitlines() if line.startswith('CDHash='))
        (folder/'full-startup-result.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))
    finally:
        try:
            os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL)
print((folder/'full-startup.log').read_text()[-6000:])
