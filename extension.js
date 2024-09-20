import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const DEFAULT_INTERVAL = 1 // seconds
let instance = null

async function* powertop(interval = DEFAULT_INTERVAL) {
	const command = `script -qc "LINES=5 powertop -t ${interval} | cat -v | tr '|' '\n'"`

	const proc = new Gio.Subprocess({
		argv: [
			'fakeroot',
			'--',
			'sh',
			'-c',
			command
		],
		flags: Gio.SubprocessFlags.STDOUT_PIPE,
	})

	proc.init(null)

	const stdoutStream = new Gio.DataInputStream({
		base_stream: proc.get_stdout_pipe(),
		close_base_stream: true,
	})

	while (true) {
		try {
			const [ line ] = await stdoutStream.read_upto_async('', 0, GLib.PRIORITY_LOW, null)

			if (line && line.trim()) {
				if (/PowerTOP/m.test(line)) {
					const [ _, dischargeRate ] = /discharge rate of (.+?) W/gim.exec(line)

					yield dischargeRate
				}
			}
		} catch (e) {
			yield null
		}
	}
}

const BatteryDischargeIndicator = GObject.registerClass({}, class extends GObject.Object {
	constructor() {
		super()

		Gio._promisify(Gio.DataInputStream.prototype, 'read_upto_async', 'read_upto_finish')
	}

	async _watch() {
		const readings = await powertop()

		while (true) {
			try {
				const { value } = await readings.next()

				if (value) {
					this._addButton()
					this._updateLabel(value)
				} else {
					this._removeButton()
				}
			} catch (e) {}
		}
	}

	enable() {
		this._checkDependencies()
		this._addButton()
		this._watch()
	}

	disable() {
		this._removeButton()
	}

	_addButton() {
		if (this._label && this._panelButton)
			return

		this._label = new St.Label({
			text: '-',
			x_expand: true,
			y_expand: true,
			y_align: Clutter.ActorAlign.CENTER,
		})

		this._panelButton = new PanelMenu.Button(0.0, 'Battery discharge rate', false)
		this._panelButton.add_child(this._label)
		this._panelButton.connect('button-press-event', () => {})

		Main.panel.addToStatusArea('Indicator', this._panelButton, 0, 'right')
	}

	_removeButton() {
		if (this._label) {
			this._label.destroy()
			this._label = null
		}

		if (this._panelButton) {
			this._panelButton.destroy()
			this._panelButton = null
		}
	}

	_updateLabel(value) {
		if (!value || isNaN(value))
			return

		this._label.set_text(value.toString() + 'W')
	}

	async _checkDependencies() {
		try {
			// const file = Gio.File.new_for_path('/usr/bin/powerpop')
			// await file.query_info_async('standard::*,unix::uid', null, GLib.PRIORITY_DEFAULT, null)
		} catch (e) {
			console.log(e)
		}
	}
})

export default class extends Extension {
	enable() {
		instance = new BatteryDischargeIndicator()
		instance.enable()
	}

	disable() {
		instance.disable()
		instance = null
	}
}
