import { bool, choice, num, text, type ControlSpec } from './controls.js'
import { pad, range } from './shared.js'

// Event 001–100, labeled to match the device's event-name nodes.
const eventChoices = (): (readonly [number, string])[] => range(1, 100).map((i) => [i, `Event ${pad(i, 3)}`])

// Fallback labels for the 1D-LUT slots; a connected unit names its own (see `choiceLabelSources`).
// Wire values are zero-based, one below the manual: gamma 0-49 User / 50-59 Preset, colour 0-9 / 10-12.
const gammaCurveChoices = (): (readonly [number, string])[] => [
	...range(1, 50).map((i): readonly [number, string] => [i - 1, `User ${pad(i, 2)}`]),
	...range(1, 10).map((i): readonly [number, string] => [49 + i, `Preset ${pad(i, 2)}`]),
]

const colorSpaceChoices = (): (readonly [number, string])[] => [
	...range(1, 10).map((i): readonly [number, string] => [i - 1, `User ${pad(i, 2)}`]),
	...range(1, 3).map((i): readonly [number, string] => [9 + i, `Preset ${pad(i, 2)}`]),
]

// FA-1616 control metadata, keyed by the definition's group key (or its id when ungrouped)

export const FA1616_CONTROLS: Record<string, ControlSpec> = {
	// Per-Channel Delay (Embedded) — 768 instances
	aud_delay: num('readwrite', { min: 1, max: 1000, factor: 1, unit: 'ms' }),
	// Per-Channel Gain (Embedded) — 768 instances
	aud_gain: num('readwrite', { min: -200, max: 200, factor: 10, unit: 'dB' }),
	// Mute (Per Group/PRU) — 48 instances
	aud_mute: bool('readwrite'),
	// Reference Level (-18/-20 dBFS) — 1 instance
	aud_reference_level: choice('readwrite', [
		[0, '-18dBFs'],
		[1, '-20dBFs'],
	]),
	// Embedded Audio Test Signal — 48 instances
	aud_test: choice('readwrite', [
		[0, 'Off'],
		[1, '400Hz Tone'],
		[2, '1kHz Tone'],
		[3, 'Mute (Silence)'],
	]),
	// CP Color Correction Bypass — 32 instances, from FA-9600 gamma_color_function
	cp_cc_bypass: choice('readwrite', [
		[0, 'Bypass'],
		[1, 'Operate'],
	]),
	// CP CC Differential Black Level (R-Y/G-Y/B-Y) — 96 instances (32 x 3 components)
	cp_diff_black: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP CC Differential White Level (R-Y/G-Y/B-Y) — 96 instances (32 x 3 components)
	cp_diff_white: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP Dynamic Range Gain — 32 instances, from FA-9600 dr_gain
	cp_dr_gain: num('readwrite', { min: -2400, max: 2400, factor: 100, unit: 'dB' }),
	// CP Input Color Space — 32 instances
	cp_in_color: choice('readwrite', colorSpaceChoices()),
	// CP Input Gamma (EOTF) — 32 instances
	cp_in_gamma: choice('readwrite', gammaCurveChoices()),
	// CP Output Color Space — 32 instances
	cp_out_color: choice('readwrite', colorSpaceChoices()),
	// CP Output Gamma (OETF) — 32 instances
	cp_out_gamma: choice('readwrite', gammaCurveChoices()),
	// CP CC Black Level Blue — 96 instances
	cp_postbal_black: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP CC Gamma Level Blue — 96 instances
	cp_postbal_gamma: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP Gamma Curve — 32 instances
	cp_postbal_gamma_curve: choice('readwrite', [
		[0, 'Center'],
		[1, 'Black'],
		[2, 'White'],
	]),
	// CP CC White Level Blue — 96 instances
	cp_postbal_white: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP Setup/Black Level — 32 instances
	cp_preamp_black: num('readwrite', { min: -200, max: 1000, factor: 10, unit: '%' }),
	// CP Chroma Level — 32 instances
	cp_preamp_chroma: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP Hue — 32 instances
	cp_preamp_hue: num('readwrite', { min: -899, max: 900, factor: 5, unit: 'deg.' }),
	// CP Video Level — 32 instances
	cp_preamp_video: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP Y Level — 32 instances
	cp_preamp_y: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// CP RGB Black Clip — 32 instances
	cp_rgbclip_black_out: num('readwrite', { min: -500, max: 500, factor: 10, unit: '%' }),
	// CP White Clip Mode — 32 instances
	cp_rgbclip_white_mode: choice('readwrite', [
		[0, 'Y Knee'],
		[1, 'RGB Knee'],
	]),
	// CP RGB White Clip — 32 instances
	cp_rgbclip_white_out: num('readwrite', { min: 500, max: 1500, factor: 10, unit: '%' }),
	// CP SDR Gain — 32 instances, from FA-9600 sdr_gain
	cp_sdr_gain: num('readwrite', { min: 0, max: 2400, factor: 100, unit: 'dB' }),
	// CP Total Gain — 32 instances, from FA-9600 total_gain
	cp_total_gain: num('read', { min: -4800, max: 4800, factor: 100, unit: 'dB' }),
	// CP YCbCr Black — 32 instances
	cp_ycbcr_black: num('readwrite', { min: -75, max: 500, factor: 10, unit: '%' }),
	// CP YCbCr Chroma — 32 instances
	cp_ycbcr_chroma: num('readwrite', { min: 500, max: 1130, factor: 10, unit: '%' }),
	// CP YCbCr White — 32 instances
	cp_ycbcr_white: num('readwrite', { min: 500, max: 1090, factor: 10, unit: '%' }),
	// Delete Event (Number) — 1 instance ("0" deletes all)
	event_delete: choice('write', [[0, 'Delete All'], ...eventChoices()]),
	// Load Event (Number) — 1 instance ("0" loads default values)
	event_load: choice('write', [[0, 'Default Values'], ...eventChoices()]),
	// Event Overwrite — 100 instances
	event_overwrite: bool('readwrite'),
	// Save Event (Number) — 1 instance
	event_save: choice('write', eventChoices()),
	// Video Freeze On/Off — 32 instances
	freeze_freeze: bool('readwrite'),
	// Video Freeze Mode — 32 instances
	freeze_freeze_mode: choice('readwrite', [
		[0, 'Frame'],
		[1, 'Odd'],
		[2, 'Even'],
	]),
	// Video Test Signal — 32 instances
	freeze_test: choice('readwrite', [
		[0, 'Disable'],
		[1, '100% Color Bar'],
		[2, '75% Color Bar'],
	]),
	// Input Link (4KFS/Workflow) — 12 instances
	input_link: choice('readwrite', [
		[0, 'Single Link'],
		[1, 'Dual Link'],
		[2, 'Quad Link'],
		[3, '2K x 4'],
	]),
	// Video Input Select — 48 instances
	input_select: choice('readwrite', [
		[0, 'SDI A1'],
		[1, 'SDI A2'],
		[2, 'SDI A3'],
		[3, 'SDI A4'],
		[4, 'SDI A5'],
		[5, 'SDI A6'],
		[6, 'SDI A7'],
		[7, 'SDI A8'],
		[16, 'IP A1'],
		[17, 'IP A2'],
		[18, 'IP A3'],
		[19, 'IP A4'],
		[20, 'IP A5'],
		[21, 'IP A6'],
		[22, 'IP A7'],
		[23, 'IP A8'],
		[24, 'RECV 2-1'],
		[25, 'RECV 2-2'],
		[26, 'RECV 2-3'],
		[27, 'RECV 2-4'],
	]),
	// Startup Event Number — 1 instance
	startup_event_number: choice('readwrite', eventChoices()),
	// Startup Event Type — 1 instance
	startup_event_type: choice('readwrite', [
		[0, 'Last Settings'],
		[1, 'Default Value'],
		[2, 'Event Number'],
	]),
	// Sync Back Color — 8 instances
	sync_back_color: choice('readwrite', [[0, 'Black']]),
	// Sync SQD / 2SI Division — 8 instances
	sync_division: choice('readwrite', [
		[0, 'Follow Input'],
		[1, 'SQD'],
		[2, '2SI'],
	]),
	// Sync Output Format Status — 8 instances
	sync_format_status: text('read'),
	// Sync Genlock In Signal — 8 instances
	sync_genlock_in_signal: text('read'),
	// Sync Genlock Status — 8 instances
	sync_genlock_status: choice('read', [
		[0, 'Locked'],
		[1, 'Holdover'],
		[2, 'Locking'],
		[3, 'Internal'],
		[4, 'Loss'],
		[5, 'PTP Error (No messages received on SFP1.)'],
	]),
	// Sync Horizontal Phase — 8 instances
	sync_h_timing: num('readwrite', { min: -2750, max: 2750, factor: 1, unit: 'clock' }),
	// Sync IP Latency — 32 instances
	sync_ip_delay: text('read'),
	// Sync Sync Setting Mode (Auto/Manual) — 8 instances
	sync_is_manual: choice('readwrite', [
		[0, 'Auto Detect'],
		[1, 'Manual'],
	]),
	// Sync 3G SDI Output Level — 8 instances
	sync_level: choice('readwrite', [
		[0, 'Follow Input'],
		[1, 'Level A'],
		[2, 'Level B'],
	]),
	// Sync Video Input Loss Mode — 8 instances
	sync_loss_mode: choice('readwrite', [
		[0, 'Back Color(Link)'],
		[1, 'Back Color(Separate)'],
		[8, 'Auto Freeze'],
	]),
	// Sync Sync Mode — 8 instances
	sync_mode: choice('readwrite', [
		[0, 'Frame'],
		[1, 'Line'],
		[2, 'AVDL'],
	]),
	// Sync PTP/Input Lock Signal — 8 instances
	sync_ptp_signal: text('read'),
	// Sync Rate — 8 instances
	sync_rate: choice('readwrite', [
		[0, '60p'],
		[1, '59.94p'],
		[2, '50p'],
		[3, '48p'],
		[4, '47.95p'],
		[5, '30p'],
		[6, '29.97p'],
		[7, '25p'],
		[8, '24p'],
		[9, '23.98p'],
		[10, '60i'],
		[11, '59.94i'],
		[12, '50i'],
		[13, '24PsF'],
		[14, '23PsF'],
		[15, '30PsF'],
		[16, '29.97PsF'],
		[17, '25PsF'],
	]),
	// Sync SDI Latency — 32 instances
	sync_sdi_delay: text('read'),
	// Sync Standard — 8 instances
	sync_standard: choice('readwrite', [
		[1, '720'],
		[2, '1080'],
		[3, '2160'],
	]),
	// Sync Signal Latency — 32 instances
	sync_total_delay: text('read'),
	// Sync Vertical Phase — 8 instances
	sync_v_timing: num('readwrite', { min: -563, max: 563, factor: 1, unit: 'line' }),
}
