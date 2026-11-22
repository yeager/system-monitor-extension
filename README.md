# GNOME System Monitor

Displays CPU and memory usage in the right side of the GNOME panel. Left-click the indicator to open compact five-minute graphs and the three processes using the most CPU and memory. Right-click for Settings (update interval from 1 to 10 seconds), About, and Quit. GNOME notifications appear when CPU or memory rises above 50% or 75%, or reaches 100%; each notification names the leading process. Statistics are read from Linux `/proc`.

## Install

Install the [latest release](https://github.com/yeager/system-monitor-extension/releases/latest):

```sh
gnome-extensions install system-monitor@yeager-v3.shell-extension.zip
gnome-extensions enable system-monitor@yeager-v3
```

Log out and back in if the extension does not appear immediately. On X11, GNOME Shell can be restarted with `Alt`+`F2`, then `r`; on Wayland, log out and back in.

Check the GNOME Shell version with `gnome-shell --version`. The metadata lists support for GNOME 49–51.

## Translations

English is the default language. Swedish translations are in `po/sv.po` and compiled to `locale/sv/LC_MESSAGES/system-monitor.mo`.
