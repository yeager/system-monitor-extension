import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const HISTORY_SECONDS = 300;
const HIGH_LOAD_DELAY_SECONDS = 10;
const GRAPH_WIDTH = 310;
const GRAPH_HEIGHT = 78;
const gettextDomain = Gettext.domain('system-monitor');
const _ = gettextDomain.gettext;
const ngettext = gettextDomain.ngettext;

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

function addLabel(box, text, styleClass, expand = true) {
    const label = new St.Label({
        text,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: expand,
        style_class: styleClass,
    });
    box.add_child(label);
    return label;
}

function addProcessRow(box) {
    const row = new St.BoxLayout({ style_class: 'system-monitor-process-row' });
    const name = addLabel(row, '–', 'system-monitor-process-name');
    const value = addLabel(row, '', 'system-monitor-process-value', false);
    value.x_align = Clutter.ActorAlign.END;
    box.add_child(row);
    return { name, value };
}

const GraphArea = GObject.registerClass(
class GraphArea extends St.DrawingArea {
    _init(color, network = false) {
        super._init({ style_class: 'system-monitor-graph' });
        this._color = color;
        this._network = network;
        this._samples = [];
        this.set_size(GRAPH_WIDTH, GRAPH_HEIGHT);
        this.connect('repaint', () => this._draw());
    }

    setSamples(samples) {
        this._samples = samples;
        this.queue_repaint();
    }

    _draw() {
        const [width, height] = this.get_surface_size();
        if (width < 1 || height < 1)
            return;

        const cr = this.get_context();
        const left = 26;
        const right = width - 5;
        const top = 5;
        const bottom = height - 17;
        const plotWidth = right - left;
        const plotHeight = bottom - top;
        cr.setLineWidth(1);
        const points = this._samples.filter(sample => sample.time >=
            GLib.get_monotonic_time() / 1_000_000 - HISTORY_SECONDS);
        let maximum = 100;
        if (this._network) {
            const peak = Math.max(0, ...points.flatMap(sample => [sample.rx, sample.tx]));
            maximum = Math.max(1024 * 1024, Math.ceil(peak / (1024 * 1024) * 2) / 2 * 1024 * 1024);
        }
        const gridValues = this._network ? [0, maximum / 2, maximum] : [0, 50, 100];
        for (const value of gridValues) {
            const y = bottom - (value / maximum) * plotHeight;
            cr.setSourceRGBA(1, 1, 1, value === 0 ? 0.17 : 0.075);
            cr.moveTo(left, y + 0.5);
            cr.lineTo(right, y + 0.5);
            cr.stroke();
        }
        cr.setSourceRGBA(1, 1, 1, 0.32);
        cr.selectFontFace('Cantarell', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(9);
        const axisLabels = this._network
            ? [this._formatRate(maximum), this._formatRate(maximum / 2), this._formatRate(0)]
            : ['100', '50', '0'];
        cr.moveTo(1, top + 4);
        cr.showText(axisLabels[0]);
        cr.moveTo(1, top + plotHeight / 2 + 3);
        cr.showText(axisLabels[1]);
        cr.moveTo(15, bottom + 3);
        cr.showText(axisLabels[2]);
        const now = GLib.get_monotonic_time() / 1_000_000;
        const start = now - HISTORY_SECONDS;
        if (points.length > 0) {
            const drawSeries = (key, color) => {
                const [red, green, blue] = color;
                const coords = points.map(sample => ({
                    x: left + Math.max(0, Math.min(1, (sample.time - start) / HISTORY_SECONDS)) * plotWidth,
                    y: bottom - (Math.max(0, sample[key]) / maximum) * plotHeight,
                }));
            const first = coords[0];
            const last = points[points.length - 1];
            const lastX = left + Math.max(0, Math.min(1, (last.time - start) / HISTORY_SECONDS)) * plotWidth;
            const gradient = new Cairo.LinearGradient(0, top, 0, bottom);
            gradient.addColorStopRGBA(0, red, green, blue, 0.34);
            gradient.addColorStopRGBA(1, red, green, blue, 0.025);
            cr.setSource(gradient);
            cr.moveTo(first.x, bottom);
            cr.lineTo(first.x, first.y);
            for (let i = 1; i < coords.length; i++) {
                const previous = coords[i - 1];
                const point = coords[i];
                const midpoint = (previous.x + point.x) / 2;
                cr.curveTo(midpoint, previous.y, midpoint, point.y, point.x, point.y);
            }
            cr.lineTo(lastX, bottom);
            cr.closePath();
            cr.fill();

            cr.setSourceRGBA(red, green, blue, 0.95);
            cr.setLineWidth(1.7);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.moveTo(first.x, first.y);
            for (let i = 1; i < coords.length; i++) {
                const previous = coords[i - 1];
                const point = coords[i];
                const midpoint = (previous.x + point.x) / 2;
                cr.curveTo(midpoint, previous.y, midpoint, point.y, point.x, point.y);
            }
            cr.stroke();
            const current = coords[coords.length - 1];
            cr.arc(current.x, current.y, 2.2, 0, Math.PI * 2);
            cr.fill();
            };
            if (this._network) {
                drawSeries('rx', [0.38, 0.72, 1.0]);
                drawSeries('tx', [0.62, 0.82, 0.45]);
            } else {
                drawSeries('value', this._color);
            }
        }
        cr.$dispose();
    }

    _formatRate(bytesPerSecond) {
        if (bytesPerSecond >= 1024 * 1024)
            return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)}M`;
        if (bytesPerSecond >= 1024)
            return `${(bytesPerSecond / 1024).toFixed(0)}K`;
        return `${bytesPerSecond.toFixed(0)}B`;
    }
});

const MonitorIndicator = GObject.registerClass(
class MonitorIndicator extends PanelMenu.Button {
    _init(onQuit, version) {
        super._init(0.5, _('CPU and Memory'));
        this._onQuit = onQuit;
        this._version = version;
        this._interval = 1;
        this._lastCpu = this._readCpu();
        this._lastProcesses = new Map();
        this._history = { cpu: [], memory: [], network: [] };
        this._lastNetwork = this._readNetwork();
        this._lastNetworkTime = GLib.get_monotonic_time() / 1_000_000;
        this._menuRows = [];
        this._warningStates = {
            cpu: { level: 0, since: null, notifiedLevel: 0, process: null },
            memory: { level: 0, since: null, notifiedLevel: 0, process: null },
            network: { level: 0, since: null, notifiedLevel: 0, process: null },
        };

        this._label = new St.Label({
            text: 'CPU --%  RAM --%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-monitor-panel-label',
        });
        this.add_child(this._label);
        this._buildMenu();
        this._refresh();
        this._startTimer();
    }

    _buildContextMenu() {
        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);
        this._contextMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._contextMenuManager.addMenu(this._contextMenu);

        this._populateActionsMenu(this._contextMenu);
        this._buttonPressId = this.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this._contextMenu.toggle();
            return Clutter.EVENT_STOP;
        });
    }

    _populateActionsMenu(menu) {
        const settings = new PopupMenu.PopupSubMenuMenuItem(_('Settings'), false);
        this._intervalItems ??= [];
        for (let seconds = 1; seconds <= 10; seconds++) {
            const item = new PopupMenu.PopupMenuItem('');
            item.connect('activate', () => this._setInterval(seconds, null));
            this._intervalItems.push({ item, seconds });
            settings.menu.addMenuItem(item);
        }
        menu.addMenuItem(settings);
        this._updateIntervalLabels();

        const about = new PopupMenu.PopupMenuItem(_('About'));
        about.connect('activate', () => Main.notify(
            _('CPU and memory monitor'),
            _('Version %d').replace('%d', this._version)
        ));
        menu.addMenuItem(about);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const quit = new PopupMenu.PopupMenuItem(_('Quit'));
        quit.connect('activate', () => this._onQuit());
        menu.addMenuItem(quit);
    }

    _updateIntervalLabels() {
        for (const { item, seconds } of this._intervalItems ?? []) {
            const selected = seconds === this._interval ? '✓ ' : '';
            const duration = ngettext('%d second', '%d seconds', seconds).replace('%d', seconds);
            item.label.text = `${selected}${duration}`;
        }
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('system-monitor-menu');

        const graphs = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const graphBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, style_class: 'system-monitor-content' });
        const cpuHeading = new St.BoxLayout({ style_class: 'system-monitor-heading' });
        addLabel(cpuHeading, _('CPU'), 'system-monitor-title');
        this._cpuValue = addLabel(cpuHeading, '--%', 'system-monitor-value');
        graphBox.add_child(cpuHeading);
        this._cpuGraph = new GraphArea([0.38, 0.72, 1.0]);
        graphBox.add_child(this._cpuGraph);
        const cpuAxis = new St.BoxLayout({ style_class: 'system-monitor-time-axis' });
        addLabel(cpuAxis, _('5 min ago'), 'system-monitor-time-label');
        addLabel(cpuAxis, _('Now'), 'system-monitor-time-label');
        graphBox.add_child(cpuAxis);

        const memoryHeading = new St.BoxLayout({ style_class: 'system-monitor-heading' });
        addLabel(memoryHeading, _('Memory'), 'system-monitor-title');
        this._memoryValue = addLabel(memoryHeading, '--%', 'system-monitor-value');
        graphBox.add_child(memoryHeading);
        this._memoryGraph = new GraphArea([0.62, 0.82, 0.45]);
        graphBox.add_child(this._memoryGraph);
        const memoryAxis = new St.BoxLayout({ style_class: 'system-monitor-time-axis' });
        addLabel(memoryAxis, _('5 min ago'), 'system-monitor-time-label');
        addLabel(memoryAxis, _('Now'), 'system-monitor-time-label');
        graphBox.add_child(memoryAxis);

        const networkHeading = new St.BoxLayout({ style_class: 'system-monitor-heading' });
        addLabel(networkHeading, _('Network'), 'system-monitor-title');
        this._networkValue = addLabel(networkHeading, '--', 'system-monitor-value');
        graphBox.add_child(networkHeading);
        this._networkGraph = new GraphArea([0.38, 0.72, 1.0], true);
        graphBox.add_child(this._networkGraph);
        const networkAxis = new St.BoxLayout({ style_class: 'system-monitor-time-axis' });
        addLabel(networkAxis, _('5 min ago'), 'system-monitor-time-label');
        addLabel(networkAxis, _('Now'), 'system-monitor-time-label');
        graphBox.add_child(networkAxis);
        graphs.add_child(graphBox);
        this.menu.addMenuItem(graphs);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const processItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const processBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, style_class: 'system-monitor-processes' });
        addLabel(processBox, _('Top CPU'), 'system-monitor-section-title');
        for (let i = 0; i < 3; i++)
            this._menuRows.push({ cpu: addProcessRow(processBox), memory: null });
        addLabel(processBox, _('Top memory'), 'system-monitor-section-title');
        for (let i = 0; i < 3; i++)
            this._menuRows[i].memory = addProcessRow(processBox);
        processItem.add_child(processBox);
        this.menu.addMenuItem(processItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const frequency = new PopupMenu.PopupSubMenuMenuItem(_('Update interval: 1 s'), false);
        this._intervalMenuItem = frequency;
        for (let seconds = 1; seconds <= 10; seconds++) {
            const item = new PopupMenu.PopupMenuItem(ngettext('%d second', '%d seconds', seconds).replace('%d', seconds));
            item.connect('activate', () => this._setInterval(seconds, frequency));
            frequency.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(frequency);
    }

    _readCpu() {
        const line = readText('/proc/stat')?.split('\n')[0];
        if (!line)
            return null;
        const fields = line.trim().split(/\s+/).slice(1).map(Number);
        return {
            idle: fields[3] + (fields[4] || 0),
            total: fields.reduce((sum, value) => sum + value, 0),
        };
    }

    _readMemory() {
        const text = readText('/proc/meminfo');
        const total = Number(text?.match(/^MemTotal:\s+(\d+)/m)?.[1]);
        const available = Number(text?.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
        if (!total || !Number.isFinite(available))
            return null;
        return { percent: Math.round((total - available) * 100 / total), total, available };
    }

    _readNetwork() {
        const lines = readText('/proc/net/dev')?.split('\n').slice(2) ?? [];
        let rx = 0;
        let tx = 0;
        let rxCapacity = 0;
        let txCapacity = 0;
        const interfaces = {};
        for (const line of lines) {
            const [interfaceName, counters] = line.trim().split(':');
            const name = interfaceName?.trim();
            if (!counters || !name || name === 'lo' ||
                !Gio.File.new_for_path(`/sys/class/net/${name}/device`).query_exists(null))
                continue;
            const values = counters.trim().split(/\s+/).map(Number);
            if (values.length < 9 || values.some(value => !Number.isFinite(value)))
                continue;

            const capacity = this._readInterfaceCapacity(name);
            interfaces[name] = {
                rx: values[0],
                tx: values[8],
                rxCapacity: capacity.rx,
                txCapacity: capacity.tx,
            };
            rx += values[0];
            tx += values[8];
            rxCapacity += capacity.rx;
            txCapacity += capacity.tx;
        }
        return { rx, tx, rxCapacity, txCapacity, interfaces };
    }

    _readInterfaceCapacity(name) {
        const speedMbps = Number(readText(`/sys/class/net/${name}/speed`));
        if (Number.isFinite(speedMbps) && speedMbps > 0) {
            const bytesPerSecond = speedMbps * 1_000_000 / 8;
            return { rx: bytesPerSecond, tx: bytesPerSecond };
        }

        // Wireless interfaces usually expose their negotiated receive and
        // transmit bitrates through iw rather than the sysfs speed attribute.
        if (!Gio.File.new_for_path(`/sys/class/net/${name}/wireless`).query_exists(null))
            return { rx: 0, tx: 0 };
        try {
            const [ok, output] = GLib.spawn_sync(null, ['iw', 'dev', name, 'link'],
                null, GLib.SpawnFlags.SEARCH_PATH, null);
            if (!ok)
                return { rx: 0, tx: 0 };
            const text = new TextDecoder().decode(output);
            const toBytesPerSecond = (direction) => {
                const match = text.match(new RegExp(`${direction} bitrate:\\s+([\\d.]+)\\s+(KBit/s|MBit/s|Gbit/s)`, 'i'));
                if (!match)
                    return 0;
                const multiplier = match[2].toLowerCase() === 'kbit/s' ? 1_000
                    : match[2].toLowerCase() === 'mbit/s' ? 1_000_000 : 1_000_000_000;
                return Number(match[1]) * multiplier / 8;
            };
            return { rx: toBytesPerSecond('rx'), tx: toBytesPerSecond('tx') };
        } catch {
            return { rx: 0, tx: 0 };
        }
    }

    _formatNetworkRate(bytesPerSecond) {
        if (bytesPerSecond >= 1024 * 1024)
            return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        if (bytesPerSecond >= 1024)
            return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
        return `${bytesPerSecond.toFixed(0)} B/s`;
    }

    _readProcesses(systemCpu) {
        const now = GLib.get_monotonic_time() / 1_000_000;
        const current = new Map();
        const byMemory = [];
        const names = [];
        const procDirectory = Gio.File.new_for_path('/proc');
        let enumerator = null;
        try {
            enumerator = procDirectory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null)
                names.push(info.get_name());
        } catch {
            return { byCpu: [], byMemory: [] };
        } finally {
            enumerator?.close(null);
        }
        for (const name of names) {
            if (!/^\d+$/.test(name))
                continue;
            const stat = readText(`/proc/${name}/stat`);
            if (!stat)
                continue;
            const closeParen = stat.lastIndexOf(')');
            if (closeParen < 0)
                continue;
            const command = stat.slice(stat.indexOf('(') + 1, closeParen);
            const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
            const ticks = Number(fields[11]) + Number(fields[12]);
            const rssKb = Number(readText(`/proc/${name}/status`)
                ?.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] ?? 0);
            if (!Number.isFinite(ticks) || !Number.isFinite(rssKb))
                continue;
            const pid = Number(name);
            const previous = this._lastProcesses.get(pid);
            let cpu = 0;
            if (previous && systemCpu?.delta > 0 && ticks >= previous.ticks) {
                cpu = (ticks - previous.ticks) / systemCpu.delta * GLib.get_num_processors() * 100;
            }
            current.set(pid, { ticks, time: now });
            byMemory.push({ pid, command, memory: rssKb * 1024,
                memoryPercent: this._memory?.total ? rssKb * 100 / this._memory.total : 0,
                cpu: Math.min(100 * GLib.get_num_processors(), cpu) });
        }
        this._lastProcesses = current;
        const byCpu = [...byMemory].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
        byMemory.sort((a, b) => b.memory - a.memory);
        return { byCpu, byMemory: byMemory.slice(0, 3) };
    }

    _setInterval(seconds, menuItem) {
        this._interval = seconds;
        if (menuItem)
            menuItem.label.text = _('Update interval: %d s').replace('%d', seconds);
        this._updateIntervalLabels();
        this._startTimer();
        this._refresh();
    }

    _startTimer() {
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _formatProcess(process, kind) {
        if (!process)
            return { name: '–', value: '' };
        const name = process.command.length > 22 ? `${process.command.slice(0, 21)}…` : process.command;
        const value = kind === 'cpu' ? `${process.cpu.toFixed(1)}%` : `${(process.memory / 1048576).toFixed(0)} MB`;
        return { name, value };
    }

    _warningLevel(percent) {
        if (percent === null || percent === undefined)
            return 0;
        if (percent >= 100)
            return 100;
        if (percent > 75)
            return 75;
        if (percent > 50)
            return 50;
        return 0;
    }

    _notifyThreshold(kind, level, percent, process) {
        const name = process?.command ?? _('unknown process');
        const cpu = kind === 'cpu';
        if (kind === 'network') {
            const direction = process?.direction === 'rx' ? '↓' : '↑';
            const title = _('High network usage');
            const message = _('%s · %s · %s')
                .replace('%s', `${level}%`)
                .replace('%s', name)
                .replace('%s', `${direction} ${process?.rate ?? '0'}`);
            Main.notify(title, message);
            return;
        }
        const processValue = cpu
            ? (process?.cpu ?? 0).toFixed(1)
            : ((process?.memory ?? 0) / 1048576).toFixed(0);
        const title = cpu ? _('High CPU usage') : _('High memory usage');
        const value = cpu ? `${processValue}%` : `${processValue} MB`;
        const message = _('%s · %s · %s')
            .replace('%s', `${level}%`)
            .replace('%s', name)
            .replace('%s', value);
        Main.notify(title, message);
    }

    _checkThreshold(kind, percent, process, now) {
        const nextLevel = this._warningLevel(percent);
        const state = this._warningStates[kind];
        if (nextLevel === 0) {
            state.level = 0;
            state.since = null;
            state.notifiedLevel = 0;
            state.process = null;
            return;
        }

        if (state.since === null) {
            state.since = now;
            state.process = process;
        } else if (process) {
            const metric = kind === 'cpu' ? process.cpu
                : kind === 'memory' ? process.memory : process.percent;
            const previousMetric = kind === 'cpu' ? state.process?.cpu
                : kind === 'memory' ? state.process?.memory : state.process?.percent;
            if (!state.process || metric > previousMetric)
                state.process = process;
        }
        state.level = nextLevel;

        if (now - state.since < HIGH_LOAD_DELAY_SECONDS || nextLevel <= state.notifiedLevel)
            return;

        this._notifyThreshold(kind, nextLevel, percent, state.process);
        state.notifiedLevel = nextLevel;
    }

    _refresh() {
        const now = GLib.get_monotonic_time() / 1_000_000;
        const currentCpu = this._readCpu();
        let cpuPercent = null;
        let totalDelta = 0;
        if (currentCpu && this._lastCpu) {
            totalDelta = currentCpu.total - this._lastCpu.total;
            const idleDelta = currentCpu.idle - this._lastCpu.idle;
            if (totalDelta > 0)
                cpuPercent = Math.round((totalDelta - idleDelta) * 100 / totalDelta);
        }
        this._lastCpu = currentCpu;
        this._memory = this._readMemory();
        const memoryPercent = this._memory?.percent ?? null;
        const processes = this._readProcesses({ delta: totalDelta });
        this._checkThreshold('cpu', cpuPercent, processes.byCpu[0] ?? null, now);
        this._checkThreshold('memory', memoryPercent, processes.byMemory[0] ?? null, now);
        this._label.text = `CPU ${cpuPercent ?? '--'}%  RAM ${memoryPercent ?? '--'}%`;
        this.accessible_name = _('CPU %s percent, memory %s percent')
            .replace('%s', cpuPercent ?? _('unknown'))
            .replace('%s', memoryPercent ?? _('unknown'));
        this._cpuValue.text = `${cpuPercent ?? '--'}%`;
        this._memoryValue.text = `${memoryPercent ?? '--'}%`;
        const networkNow = this._readNetwork();
        const elapsed = now - this._lastNetworkTime;
        const rxRate = elapsed > 0 && networkNow.rx >= this._lastNetwork.rx
            ? (networkNow.rx - this._lastNetwork.rx) / elapsed : 0;
        const txRate = elapsed > 0 && networkNow.tx >= this._lastNetwork.tx
            ? (networkNow.tx - this._lastNetwork.tx) / elapsed : 0;
        let networkPercent = null;
        let networkCause = null;
        const candidates = [];
        for (const [name, iface] of Object.entries(networkNow.interfaces)) {
            const old = this._lastNetwork.interfaces[name];
            if (!old || elapsed <= 0)
                continue;
            for (const direction of ['rx', 'tx']) {
                const capacity = iface[`${direction}Capacity`];
                const current = iface[direction];
                if (capacity <= 0 || current < old[direction])
                    continue;
                const rate = (current - old[direction]) / elapsed;
                candidates.push({
                    name,
                    direction,
                    rate,
                    percent: rate * 100 / capacity,
                });
            }
        }
        candidates.sort((a, b) => b.percent - a.percent);
        if (candidates.length > 0) {
            networkCause = candidates[0];
            networkPercent = networkCause.percent;
            networkCause.command = networkCause.name;
            networkCause.rate = this._formatNetworkRate(networkCause.rate);
        }
        this._checkThreshold('network', networkPercent, networkCause, now);
        this._lastNetwork = networkNow;
        this._lastNetworkTime = now;
        const networkPercentText = networkPercent === null ? '--%' : `${Math.round(networkPercent)}%`;
        this._networkValue.text = `↓ ${this._formatNetworkRate(rxRate)}  ↑ ${this._formatNetworkRate(txRate)}  ${networkPercentText}`;
        const frequencyItem = this._intervalMenuItem;
        if (frequencyItem)
            frequencyItem.label.text = _('Update interval: %d s').replace('%d', this._interval);

        if (cpuPercent !== null)
            this._history.cpu.push({ time: now, value: cpuPercent });
        if (memoryPercent !== null)
            this._history.memory.push({ time: now, value: memoryPercent });
        this._history.network.push({ time: now, rx: rxRate, tx: txRate });
        for (const key of ['cpu', 'memory', 'network']) {
            this._history[key] = this._history[key].filter(sample => sample.time >= now - HISTORY_SECONDS);
        }
        this._cpuGraph.setSamples(this._history.cpu);
        this._memoryGraph.setSamples(this._history.memory);
        this._networkGraph.setSamples(this._history.network);
        for (let i = 0; i < 3; i++) {
            const cpu = this._formatProcess(processes.byCpu[i], 'cpu');
            const memory = this._formatProcess(processes.byMemory[i], 'memory');
            this._menuRows[i].cpu.name.text = cpu.name;
            this._menuRows[i].cpu.value.text = cpu.value;
            this._menuRows[i].memory.name.text = memory.name;
            this._menuRows[i].memory.value.text = memory.value;
        }
    }

    destroy() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = 0;
        }
        if (this._buttonPressId)
            this.disconnect(this._buttonPressId);
        if (this._contextMenu?.isOpen)
            this._contextMenu.close();
        this._contextMenu?.destroy();
        super.destroy();
    }
});

export default class SystemMonitorExtension extends Extension {
    enable() {
        Gettext.bindtextdomain('system-monitor', GLib.build_filenamev([this.path, 'locale']));
        this._indicator = new MonitorIndicator(
            () => Main.extensionManager.disableExtension(this.uuid),
            this.metadata.version
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        // PopupMenu needs its source actor to be parented into the panel
        // before its BoxPointer can be created or opened.
        this._indicator._buildContextMenu();
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
