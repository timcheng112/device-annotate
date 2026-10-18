#!/usr/bin/env python3
"""Build neutral native fixtures using installed SDKs, with no Gradle or network."""
import os
import pathlib
import plistlib
import platform
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
BUILD = ROOT / '.local' / 'build'
BUILD.mkdir(parents=True, exist_ok=True)

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

def output(*args):
    return subprocess.check_output(args, text=True).strip()

if sys.argv[1] == 'ios':
    app = BUILD / 'DeviceProofFixture.app'
    app.mkdir(exist_ok=True)
    sdk = output('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path')
    run('xcrun', '--sdk', 'iphonesimulator', 'swiftc', ROOT / 'fixture.swift', '-parse-as-library', '-sdk', sdk,
        '-target', f'{platform.machine()}-apple-ios17.0-simulator', '-Xlinker', '-syslibroot', '-Xlinker', sdk,
        '-o', app / 'DeviceProofFixture')
    with (app / 'Info.plist').open('wb') as file:
        plistlib.dump(dict(CFBundleIdentifier='dev.deviceproof.fixture', CFBundleName='DeviceProofFixture',
            CFBundleDisplayName='Device Proof Fixture', CFBundleExecutable='DeviceProofFixture',
            CFBundlePackageType='APPL', CFBundleVersion='1', CFBundleShortVersionString='1.0',
            MinimumOSVersion='17.0', LSRequiresIPhoneOS=True, UILaunchScreen={}, UIDeviceFamily=[1],
            UISupportedInterfaceOrientations=['UIInterfaceOrientationPortrait']), file)
    run('codesign', '--force', '--sign', '-', app)
    print(app)
elif sys.argv[1] == 'android':
    sdk = pathlib.Path(os.environ.get('ANDROID_HOME', pathlib.Path.home() / 'Library/Android/sdk'))
    bt = sdk / 'build-tools/33.0.1'
    jar = sdk / 'platforms/android-33/android.jar'
    java_home = os.environ.get('JAVA_HOME') or output('/usr/libexec/java_home')
    java = pathlib.Path(java_home) / 'bin'
    work = BUILD / 'android'
    for folder in ['classes', 'res/values', 'gen', 'dex']:
        (work / folder).mkdir(parents=True, exist_ok=True)
    (work / 'AndroidManifest.xml').write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.deviceproof.fixture" android:versionCode="1" android:versionName="1.0"><uses-sdk android:minSdkVersion="30" android:targetSdkVersion="33"/><application android:label="Device Proof Fixture" android:theme="@android:style/Theme.Material.NoActionBar" android:debuggable="true"><activity android:name=".FixtureActivity" android:exported="true" android:screenOrientation="portrait"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>''')
    ids = ['top_left', 'top_right', 'center', 'partial_left', 'bottom_right', 'partial_bottom']
    (work / 'res/values/ids.xml').write_text('<resources>' + ''.join(f'<item type="id" name="{id}"/>' for id in ids) + '</resources>')
    unsigned = work / 'unsigned.apk'
    run(bt / 'aapt', 'package', '-f', '-M', work / 'AndroidManifest.xml', '-S', work / 'res', '-I', jar, '-F', unsigned)
    run(java / 'javac', '-source', '8', '-target', '8', '-classpath', jar, '-d', work / 'classes', ROOT / 'FixtureActivity.java')
    run(bt / 'd8', '--lib', jar, '--output', work / 'dex', *sorted((work / 'classes').rglob('*.class')))
    with zipfile.ZipFile(unsigned, 'a') as file:
        file.write(work / 'dex/classes.dex', 'classes.dex')
    aligned = work / 'aligned.apk'
    run(bt / 'zipalign', '-f', '4', unsigned, aligned)
    key = work / 'fixture.keystore'
    if not key.exists():
        run(java / 'keytool', '-genkeypair', '-keystore', key, '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-alias', 'fixture', '-dname', 'CN=Device Proof Neutral Fixture', '-keyalg', 'RSA', '-validity', '3650')
    run(bt / 'apksigner', 'sign', '--ks', key, '--ks-pass', 'pass:fixture-only', '--out', BUILD / 'fixture.apk', aligned)
    print(BUILD / 'fixture.apk')
else:
    raise SystemExit('Usage: build-fixtures.py ios|android')
