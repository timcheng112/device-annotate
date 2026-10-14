#!/usr/bin/env python3
"""Read only neutral fixture identities and selected environment fields."""
import hashlib
import json
import os
import pathlib
import plistlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'test/fixtures/capture-spike'
SDK = pathlib.Path(os.environ.get('ANDROID_HOME', pathlib.Path.home() / 'Library/Android/sdk'))

def run(*args):
    return subprocess.check_output([str(x) for x in args], text=True, stderr=subprocess.DEVNULL).strip()

def sha(file):
    return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()

def load(platform):
    return json.loads((OUT / platform / 'capture.runtime.json').read_text())

ios = load('ios')['devices'][0]
android = load('android')['devices'][0]
udid = ios['id']
serial = android['id']

def adb(*args):
    return run(SDK / 'platform-tools/adb', '-s', serial, *args)

app = pathlib.Path(run('xcrun', 'simctl', 'get_app_container', udid, 'dev.deviceproof.fixture', 'app'))
info = plistlib.loads((app / 'Info.plist').read_bytes())
android_package = adb('shell', 'dumpsys', 'package', 'dev.deviceproof.fixture')
fields = {}
for key in ['versionCode', 'versionName', 'firstInstallTime', 'lastUpdateTime']:
    match = re.search(r'\b' + key + r'=([^\n]+)', android_package)
    fields[key] = match.group(1).strip() if match else None
installed_apk = adb('shell', 'pm', 'path', 'dev.deviceproof.fixture').removeprefix('package:')
installed_hash = adb('shell', 'sha256sum', installed_apk).split()[0]
local_apk_hash = sha(HERE / '.local/build/fixture.apk')
assert installed_hash == local_apk_hash, 'Installed APK differs from the built fixture'
# Whitelist display metadata, excluding host audio devices and unrelated device inventory.
io = run('xcrun', 'simctl', 'io', udid, 'enumerate')
lcd = re.search(r'\(1\) LCD:(.*?)(?=\n    \(2\)|\Z)', io, re.S).group(1)
source_files = ['fixture.swift', 'FixtureActivity.java', 'build-fixtures.py', 'prepare-android.py']
record = {
    'recordedAt': run('date', '-u', '+%Y-%m-%dT%H:%M:%SZ'),
    'host': {'macOS': run('sw_vers', '-productVersion'), 'architecture': run('uname', '-m'),
             'node': run('node', '--version'), 'npm': run('npm', '--version'),
             'xcode': run('xcodebuild', '-version'), 'iosSDK': run('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'),
             'java': run('/usr/libexec/java_home'), 'androidSDKPlatform': '33', 'androidBuildTools': '33.0.1'},
    'sourceSHA256': {name: sha(HERE / name) for name in source_files},
    'ios': {'device': ios, 'build': {key: info.get(key) for key in ['CFBundleIdentifier','CFBundleVersion','CFBundleShortVersionString']},
            'installedExecutableSHA256': sha(app / info['CFBundleExecutable']),
            'installedInfoPlistSHA256': sha(app / 'Info.plist'),
            'display': {'lcd': lcd.strip(), 'appearance': run('xcrun','simctl','ui',udid,'appearance'), 'contentSize': run('xcrun','simctl','ui',udid,'content_size')},
            'capture': load('ios')['screenshot']},
    'android': {'device': android, 'build': fields, 'installedAPKSHA256': installed_hash, 'builtAPKSHA256': local_apk_hash,
                'display': {'size': adb('shell','wm','size'), 'density': adb('shell','wm','density'),
                            'fontScale': adb('shell','settings','get','system','font_scale'),
                            'rotation': adb('shell','settings','get','system','user_rotation'),
                            'autoRotation': adb('shell','settings','get','system','accelerometer_rotation')},
                'os': {'release': adb('shell','getprop','ro.build.version.release'), 'sdk': adb('shell','getprop','ro.build.version.sdk'), 'fingerprint': adb('shell','getprop','ro.build.fingerprint')},
                'capture': load('android')['screenshot']}
}
(OUT / 'provenance.json').write_text(json.dumps(record, indent=2) + '\n')
print('Verified installed fixture build identities and recorded selected environment metadata.')
