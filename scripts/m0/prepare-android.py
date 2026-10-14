#!/usr/bin/env python3
"""Create an isolated AVD from the installed API 33 system image, without user data."""
import pathlib
root = pathlib.Path(__file__).resolve().parent / '.local/avd'
avd = root / 'DeviceProofM0.avd'
avd.mkdir(parents=True, exist_ok=True)
(root / 'DeviceProofM0.ini').write_text(f'avd.ini.encoding=UTF-8\npath={avd}\ntarget=android-33\n')
(avd / 'config.ini').write_text('''AvdId=DeviceProofM0
avd.ini.displayname=Device Proof M0
abi.type=arm64-v8a
hw.cpu.arch=arm64
hw.cpu.ncore=2
hw.device.name=pixel_3a
hw.device.manufacturer=Google
hw.lcd.width=1080
hw.lcd.height=2220
hw.lcd.density=440
hw.ramSize=2048
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.keyboard=yes
hw.mainKeys=no
hw.audioInput=no
hw.camera.back=none
hw.camera.front=none
disk.dataPartition.size=2G
image.sysdir.1=system-images/android-33/google_apis/arm64-v8a/
tag.id=google_apis
tag.display=Google APIs
PlayStore.enabled=false
showDeviceFrame=no
''')
print(root)
