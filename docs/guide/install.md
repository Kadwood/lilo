---
id: "install"
title: "Install Lilo on Mac, Windows or Linux"
summary: "Download Lilo, open it the first time, and get past the Windows SmartScreen and Linux AppImage prompts."
section: "getting-started"
order: 2
keywords: ["install", "download", "mac", "macos", "windows", "smartscreen", "linux", "appimage", "deb", "update", "dmg"]
appContext: ["view.home"]
status: "ready"
---

# Install Lilo on Mac, Windows or Linux

Get the newest version from the **Releases page** on the Lilo GitHub project (github.com/Kadwood/lilo/releases/latest). Every release has a `SHA256SUMS` file. It lets you check that your download was not changed on the way.

## Mac

You need macOS 13 or newer. Apple Silicon and Intel Macs both work.

1. Download `Lilo_<version>_universal.dmg`.
2. Open it and drag **Lilo** onto **Applications**.
3. Open Lilo. Lilo is signed and notarized by Apple. The first time, macOS says it was downloaded from the internet. Click **Open**.
4. The first time you look for machines on your network, macOS asks to allow **Local Network** access. Say yes. Without it Lilo cannot find your sewing machine.

## Windows

You need 64-bit Windows.

1. Download `Lilo_<version>_x64-setup.exe` and run it.
2. Windows may show a blue box that says **Windows protected your PC**. That is SmartScreen. It appears because the Lilo installer is not code-signed yet. It does not mean the file is bad.
3. Click **More info**, then **Run anyway**.

The installer works for your user only. You do not need admin rights.

## Linux

You need 64-bit Linux. Pick one file.

- **AppImage:** download `Lilo_<version>_amd64.AppImage`. Make it runnable with `chmod +x Lilo_*.AppImage`, then double-click it or run it from a terminal. On newer Ubuntu you also need FUSE 2. Install it with `sudo apt install libfuse2`.
- **Deb package:** download `Lilo_<version>_amd64.deb` and run `sudo apt install ./Lilo_*.deb`.

## Updates

Lilo checks the Releases page once a day when it starts. If there is a new version, a banner offers **Install and restart**. Lilo only talks to that page. You can turn the check off, or run it by hand, under **Lilo Link**, then **Settings**, then **Updates**.

## Next step

Open Lilo and follow [Your first design in five minutes](first-design.md).
