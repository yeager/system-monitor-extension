# GNOME System Monitor

Displays CPU and memory usage in the right side of the GNOME panel. Left-click the indicator to open compact five-minute graphs for CPU, memory, and network traffic. The network graph separates download and upload rates. The panel also lists the three processes using the most CPU and memory. Right-click for Settings (update interval from 1 to 10 seconds), About, and Quit.

GNOME notifications appear when CPU or memory usage rises above 50% or 75%, or reaches 100%, and when a network interface exceeds the same percentage of its link capacity. A high level must persist for at least 10 seconds before notification. CPU and memory notifications identify the leading process; network notifications identify the interface, direction, and rate. Wired link capacity comes from the network device; Wi-Fi capacity uses its currently negotiated receive and transmit bitrates when `iw` is available. Statistics are read from Linux `/proc` and `/sys`.

## Install

Install the [latest release](https://github.com/yeager/system-monitor-extension/releases/latest):

```sh
gnome-extensions install system-monitor@yeager-v3.shell-extension.zip
gnome-extensions enable system-monitor@yeager-v3
```

The release also includes architecture-independent Debian and RPM packages. If you use the Yeager package repositories, install with `sudo apt install gnome-shell-extension-system-monitor` or `sudo dnf install gnome-shell-extension-system-monitor`. Otherwise, download the `.deb` or `.rpm` release asset and install it with your package manager. Log out and back in after installation, then enable the extension with the command above.

Log out and back in if the extension does not appear immediately. On X11, GNOME Shell can be restarted with `Alt`+`F2`, then `r`; on Wayland, log out and back in.

Check the GNOME Shell version with `gnome-shell --version`. The metadata lists support for GNOME 49–51.

## Translations

English is the default language. Swedish translations are in `po/sv.po` and compiled to `locale/sv/LC_MESSAGES/system-monitor.mo`.

## Build packages

Install `dpkg-deb`, `rpmbuild`, and `tar`, then run:

```sh
python3 packaging/build-packages.py --version 1.0.3 --output dist
```

Published GitHub releases automatically receive the `.deb`, `.rpm`, extension ZIP, and `SHA256SUMS` assets.
