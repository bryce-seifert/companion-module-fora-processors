import { bool, choice, num, text, type ControlSpec } from './controls.js'
import { pad, range } from './shared.js'

// Event 001–100, labeled to match the device's event-name nodes.
const eventChoices = (): (readonly [number, string])[] => range(1, 100).map((i) => [i, `Event ${pad(i, 3)}`])

// FA-9600 control metadata, keyed by the definition's group key (or its id when ungrouped).

export const FA9600_CONTROLS: Record<string, ControlSpec> = {
	// Audio Reference Level (-18/-20 dBFS) — 1 instance
	audio_reference_level: choice('readwrite', [
		[0, '-18 dBFS'],
		[1, '-20 dBFS'],
	]),
	// FS2 Back Color — 2 instances
	back_color: choice('readwrite', [
		[0, 'Black'],
		[1, 'Blue'],
		[2, 'Red'],
		[3, 'Magenta'],
		[4, 'Green'],
		[5, 'Cyan'],
		[6, 'Yellow'],
	]),
	// FS2 Color Label 01 — 2 instances
	color_label_01: text('read'),
	// FS2 Color Label 02 — 2 instances
	color_label_02: text('read'),
	// FS2 Color Label 03 — 2 instances
	color_label_03: text('read'),
	// FS2 Color Label 04 — 2 instances
	color_label_04: text('read'),
	// FS2 Color Label 05 — 2 instances
	color_label_05: text('read'),
	// FS2 Color Label 06 — 2 instances
	color_label_06: text('read'),
	// FS2 Color Label 07 — 2 instances
	color_label_07: text('read'),
	// FS2 CC Differential Black Level B-Y — 6 instances
	diff_black: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 CC Differential White Level B-Y — 6 instances
	diff_white: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 SQD / 2SI Division — 2 instances
	division: choice('readwrite', [
		[0, 'Follow Input'],
		[1, 'SQD'],
		[2, '2SI'],
	]),
	// FS2 Dynamic Range Gain — 2 instances
	dr_gain: num('readwrite', { min: -2400, max: 2400, factor: 100, unit: 'dB' }),
	// Event 000 - Name — 1 instance
	event_000: text('read'),
	// Event 001 - Name — 1 instance
	event_001: text('read'),
	// Event 002 - Name — 1 instance
	event_002: text('read'),
	// Event 003 - Name — 1 instance
	event_003: text('read'),
	// Event 004 - Name — 1 instance
	event_004: text('read'),
	// Event 005 - Name — 1 instance
	event_005: text('read'),
	// Event 006 - Name — 1 instance
	event_006: text('read'),
	// Event 007 - Name — 1 instance
	event_007: text('read'),
	// Event 008 - Name — 1 instance
	event_008: text('read'),
	// Event 009 - Name — 1 instance
	event_009: text('read'),
	// Event 010 - Name — 1 instance
	event_010: text('read'),
	// Event 011 - Name — 1 instance
	event_011: text('read'),
	// Event 012 - Name — 1 instance
	event_012: text('read'),
	// Event 013 - Name — 1 instance
	event_013: text('read'),
	// Event 014 - Name — 1 instance
	event_014: text('read'),
	// Event 015 - Name — 1 instance
	event_015: text('read'),
	// Event 016 - Name — 1 instance
	event_016: text('read'),
	// Event 017 - Name — 1 instance
	event_017: text('read'),
	// Event 018 - Name — 1 instance
	event_018: text('read'),
	// Event 019 - Name — 1 instance
	event_019: text('read'),
	// Event 020 - Name — 1 instance
	event_020: text('read'),
	// Event 021 - Name — 1 instance
	event_021: text('read'),
	// Event 022 - Name — 1 instance
	event_022: text('read'),
	// Event 023 - Name — 1 instance
	event_023: text('read'),
	// Event 024 - Name — 1 instance
	event_024: text('read'),
	// Event 025 - Name — 1 instance
	event_025: text('read'),
	// Event 026 - Name — 1 instance
	event_026: text('read'),
	// Event 027 - Name — 1 instance
	event_027: text('read'),
	// Event 028 - Name — 1 instance
	event_028: text('read'),
	// Event 029 - Name — 1 instance
	event_029: text('read'),
	// Event 030 - Name — 1 instance
	event_030: text('read'),
	// Event 031 - Name — 1 instance
	event_031: text('read'),
	// Event 032 - Name — 1 instance
	event_032: text('read'),
	// Event 033 - Name — 1 instance
	event_033: text('read'),
	// Event 034 - Name — 1 instance
	event_034: text('read'),
	// Event 035 - Name — 1 instance
	event_035: text('read'),
	// Event 036 - Name — 1 instance
	event_036: text('read'),
	// Event 037 - Name — 1 instance
	event_037: text('read'),
	// Event 038 - Name — 1 instance
	event_038: text('read'),
	// Event 039 - Name — 1 instance
	event_039: text('read'),
	// Event 040 - Name — 1 instance
	event_040: text('read'),
	// Event 041 - Name — 1 instance
	event_041: text('read'),
	// Event 042 - Name — 1 instance
	event_042: text('read'),
	// Event 043 - Name — 1 instance
	event_043: text('read'),
	// Event 044 - Name — 1 instance
	event_044: text('read'),
	// Event 045 - Name — 1 instance
	event_045: text('read'),
	// Event 046 - Name — 1 instance
	event_046: text('read'),
	// Event 047 - Name — 1 instance
	event_047: text('read'),
	// Event 048 - Name — 1 instance
	event_048: text('read'),
	// Event 049 - Name — 1 instance
	event_049: text('read'),
	// Event 050 - Name — 1 instance
	event_050: text('read'),
	// Event 051 - Name — 1 instance
	event_051: text('read'),
	// Event 052 - Name — 1 instance
	event_052: text('read'),
	// Event 053 - Name — 1 instance
	event_053: text('read'),
	// Event 054 - Name — 1 instance
	event_054: text('read'),
	// Event 055 - Name — 1 instance
	event_055: text('read'),
	// Event 056 - Name — 1 instance
	event_056: text('read'),
	// Event 057 - Name — 1 instance
	event_057: text('read'),
	// Event 058 - Name — 1 instance
	event_058: text('read'),
	// Event 059 - Name — 1 instance
	event_059: text('read'),
	// Event 060 - Name — 1 instance
	event_060: text('read'),
	// Event 061 - Name — 1 instance
	event_061: text('read'),
	// Event 062 - Name — 1 instance
	event_062: text('read'),
	// Event 063 - Name — 1 instance
	event_063: text('read'),
	// Event 064 - Name — 1 instance
	event_064: text('read'),
	// Event 065 - Name — 1 instance
	event_065: text('read'),
	// Event 066 - Name — 1 instance
	event_066: text('read'),
	// Event 067 - Name — 1 instance
	event_067: text('read'),
	// Event 068 - Name — 1 instance
	event_068: text('read'),
	// Event 069 - Name — 1 instance
	event_069: text('read'),
	// Event 070 - Name — 1 instance
	event_070: text('read'),
	// Event 071 - Name — 1 instance
	event_071: text('read'),
	// Event 072 - Name — 1 instance
	event_072: text('read'),
	// Event 073 - Name — 1 instance
	event_073: text('read'),
	// Event 074 - Name — 1 instance
	event_074: text('read'),
	// Event 075 - Name — 1 instance
	event_075: text('read'),
	// Event 076 - Name — 1 instance
	event_076: text('read'),
	// Event 077 - Name — 1 instance
	event_077: text('read'),
	// Event 078 - Name — 1 instance
	event_078: text('read'),
	// Event 079 - Name — 1 instance
	event_079: text('read'),
	// Event 080 - Name — 1 instance
	event_080: text('read'),
	// Event 081 - Name — 1 instance
	event_081: text('read'),
	// Event 082 - Name — 1 instance
	event_082: text('read'),
	// Event 083 - Name — 1 instance
	event_083: text('read'),
	// Event 084 - Name — 1 instance
	event_084: text('read'),
	// Event 085 - Name — 1 instance
	event_085: text('read'),
	// Event 086 - Name — 1 instance
	event_086: text('read'),
	// Event 087 - Name — 1 instance
	event_087: text('read'),
	// Event 088 - Name — 1 instance
	event_088: text('read'),
	// Event 089 - Name — 1 instance
	event_089: text('read'),
	// Event 090 - Name — 1 instance
	event_090: text('read'),
	// Event 091 - Name — 1 instance
	event_091: text('read'),
	// Event 092 - Name — 1 instance
	event_092: text('read'),
	// Event 093 - Name — 1 instance
	event_093: text('read'),
	// Event 094 - Name — 1 instance
	event_094: text('read'),
	// Event 095 - Name — 1 instance
	event_095: text('read'),
	// Event 096 - Name — 1 instance
	event_096: text('read'),
	// Event 097 - Name — 1 instance
	event_097: text('read'),
	// Event 098 - Name — 1 instance
	event_098: text('read'),
	// Event 099 - Name — 1 instance
	event_099: text('read'),
	// Event 100 - Name — 1 instance
	event_100: text('read'),
	// Load Event (Number) — 1 instance
	event_load: choice('write', [[0, 'Default Event'], ...eventChoices()]),
	// Save Event (Number) — 1 instance
	event_save: choice('write', eventChoices()),
	// FS2 Sync Setting Mode (Auto/Manual) — 2 instances
	format_setting: choice('readwrite', [
		[0, 'Auto Detect'],
		[1, 'Manual'],
	]),
	// FS2 Video Freeze On/Off — 2 instances
	freeze: choice('readwrite', [
		[0, 'Off'],
		[1, 'On'],
	]),
	// FS2 Video Freeze Mode — 2 instances
	freeze_mode: choice('readwrite', [
		[0, 'Frame'],
		[1, 'Odd'],
		[2, 'Even'],
	]),
	// FS2 Color Correction Bypass — 2 instances
	gamma_color_function: choice('readwrite', [
		[0, 'Bypass'],
		[1, 'Operate'],
	]),
	// FS2 Gamma Label 01 — 2 instances
	gamma_label_01: text('read'),
	// FS2 Gamma Label 02 — 2 instances
	gamma_label_02: text('read'),
	// FS2 Gamma Label 03 — 2 instances
	gamma_label_03: text('read'),
	// FS2 Gamma Label 04 — 2 instances
	gamma_label_04: text('read'),
	// FS2 Gamma Label 05 — 2 instances
	gamma_label_05: text('read'),
	// FS2 Gamma Label 06 — 2 instances
	gamma_label_06: text('read'),
	// FS2 Gamma Label 07 — 2 instances
	gamma_label_07: text('read'),
	// FS2 Gamma Label 08 — 2 instances
	gamma_label_08: text('read'),
	// FS2 Gamma Label 09 — 2 instances
	gamma_label_09: text('read'),
	// FS2 Gamma Label 10 — 2 instances
	gamma_label_10: text('read'),
	// Input 1 Format — 1 instance
	in1_format: text('read'),
	// Input 2 Format — 1 instance
	in2_format: text('read'),
	// Input Channel Delay Ch32 — 32 instances
	in_delay: num('readwrite', { min: 1, max: 1000, factor: 1, unit: 'ms' }),
	// FS2 RGB Black Clip — 2 instances
	knee_black_out_clip: num('readwrite', { min: -500, max: 500, factor: 10, unit: '%' }),
	// FS2 Clip Mode — 2 instances
	knee_white_mode: choice('readwrite', [
		[0, 'Y Knee'],
		[1, 'RGB Knee'],
	]),
	// FS2 RGB White Clip — 2 instances
	knee_white_out_clip: num('readwrite', { min: 500, max: 1500, factor: 10, unit: '%' }),
	// FS2 3G SDI Output Level — 2 instances
	level: choice('readwrite', [
		[0, 'Follow Input'],
		[1, 'Level-A'],
		[2, 'Level-B'],
	]),
	// FS2 Video Input Loss Mode — 2 instances
	loss_mode: choice('readwrite', [
		[0, 'Back Color (Link)'],
		[1, 'Back Color (Sep)'],
		[2, 'Back Color'],
		[8, 'Auto Freeze'],
		[10, 'SDI Output Mute (Link)'],
		[11, 'SDI Output Mute (Sep)'],
	]),
	// FS2 Input Color Space — 2 instances
	lut_in_color: choice('readwrite', [
		[0, 'Rec. ITU-R BT.709'],
		[1, 'Rec. ITU-R BT.2020'],
		[2, 'User 1'],
		[3, 'User 2'],
		[4, 'User 3'],
		[5, 'User 4'],
		[6, 'User 5'],
	]),
	// FS2 Input Gamma (EOTF) — 2 instances
	lut_in_gamma: choice('readwrite', [
		[1, 'User 01'],
		[2, 'User 02'],
		[3, 'User 03'],
		[4, 'User 04'],
		[5, 'User 05'],
		[6, 'User 06'],
		[7, 'User 07'],
		[8, 'User 08'],
		[9, 'User 09'],
		[10, 'User 10'],
		[11, 'S-Log3 Live HDR'],
		[13, 'SDR (SONY)'],
	]),
	// FS2 Output Color Space — 2 instances
	lut_out_color: choice('readwrite', [
		[0, 'Rec. ITU-R BT.709'],
		[1, 'Rec. ITU-R BT.2020'],
		[2, 'User 1'],
		[3, 'User 2'],
		[4, 'User 3'],
		[5, 'User 4'],
		[6, 'User 5'],
	]),
	// FS2 Output Gamma (OETF) — 2 instances
	lut_out_gamma: choice('readwrite', [
		[1, 'User 01'],
		[2, 'User 02'],
		[3, 'User 03'],
		[4, 'User 04'],
		[5, 'User 05'],
		[6, 'User 06'],
		[7, 'User 07'],
		[8, 'User 08'],
		[9, 'User 09'],
		[10, 'User 10'],
		[11, 'S-Log3 Live HDR'],
		[13, 'SDR (SONY)'],
	]),
	// FS2 Output Format Status — 2 instances
	out_format: text('read'),
	// Output Channel Gain Emb2 Ch16 — 32 instances
	out_gain: num('readwrite', { min: -200, max: 200, factor: 10, unit: 'dB' }),
	// Output Group Mute Emb2 — 2 instances
	out_master_mute: bool('readwrite'),
	// FS2 Setup/Black Level — 2 instances
	ppamp_black: num('readwrite', { min: -200, max: 1000, factor: 10, unit: '%' }),
	// FS2 Chroma Level — 2 instances
	ppamp_chroma: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 Hue — 2 instances
	ppamp_hue: num('readwrite', { min: -899, max: 900, factor: 5, unit: 'deg.' }),
	// FS2 Video Level — 2 instances
	ppamp_video: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 Y Level — 2 instances
	ppamp_y: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 CC Black Level Blue — 6 instances
	ppbal_black: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 CC Gamma Level Blue — 6 instances
	ppbal_gamma: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 Gamma Curve — 2 instances
	ppbal_gamma_curve: choice('readwrite', [
		[0, 'Center'],
		[1, 'Black'],
		[2, 'White'],
	]),
	// FS2 CC White Level Blue — 6 instances
	ppbal_white: num('readwrite', { min: 0, max: 2000, factor: 10, unit: '%' }),
	// FS2 Rate — 2 instances
	rate: choice('readwrite', [
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
		[14, '23.98PsF'],
		[15, '30PsF'],
		[16, '29.97PsF'],
		[17, '25PsF'],
	]),
	// Reference Format — 1 instance
	ref_format: text('read'),
	// FS2 SDR Gain — 2 instances
	sdr_gain: num('readwrite', { min: 0, max: 2400, factor: 100, unit: 'dB' }),
	// FS2 Video Input Select — 2 instances
	source_select: choice('readwrite', [
		[0, 'Synchronizer1'],
		[1, 'Converter1'],
		[2, 'Synchronizer2'],
		[3, 'Converter2'],
	]),
	// FS2 Standard — 2 instances
	standard: choice('readwrite', [
		[0, 'SD'],
		[1, '720'],
		[2, '1080'],
		[3, '2160'],
	]),
	// Startup Event — 1 instance (0: last settings, 1: default, 2–101: Event 001–100)
	startup_event: choice('readwrite', [
		[0, 'Last Settings'],
		[1, 'Default Value'],
		...range(2, 101).map((i): readonly [number, string] => [i, `Event ${pad(i - 1, 3)}`]),
	]),
	// FS2 Signal Latency — 2 instances
	sync_delay: text('read'),
	// FS2 Sync Mode — 2 instances
	sync_mode: choice('readwrite', [
		[0, 'Frame'],
		[1, 'Line'],
		[2, 'AVDL'],
		[3, 'Line(Min)'],
	]),
	// FS2 Video Test Signal — 2 instances
	test: choice('readwrite', [
		[0, 'Disable'],
		[1, '100% Color Bar'],
		[2, '75% Color Bar'],
	]),
	// Embedded Audio Test Signal Emb2 — 2 instances
	test_tone: choice('readwrite', [
		[0, 'Off'],
		[1, '500Hz Tone'],
		[2, '1kHz Tone'],
	]),
	// FS2 Horizontal Phase — 2 instances
	timing_h: num('readwrite', { min: -2750, max: 2750, factor: 1, unit: 'clock' }),
	// FS2 Vertical Phase — 2 instances
	timing_v: num('readwrite', { min: -563, max: 563, factor: 1, unit: 'line' }),
	// FS2 Total Gain — 2 instances
	total_gain: num('read', { min: -4800, max: 4800, factor: 100, unit: 'dB' }),
	// FS2 Input Link (4KFS/Workflow) — 2 instances
	uhd_input_link: choice('readwrite', [
		[0, 'Single Link'],
		[1, 'Dual Link'],
		[2, 'Quad Link'],
	]),
	// FS2 YCbCr Black — 2 instances
	ycbcr_black: num('readwrite', { min: -75, max: 500, factor: 10, unit: '%' }),
	// FS2 YCbCr Chroma — 2 instances
	ycbcr_chroma: num('readwrite', { min: 500, max: 1130, factor: 10, unit: '%' }),
	// FS2 YCbCr White — 2 instances
	ycbcr_white: num('readwrite', { min: 500, max: 1090, factor: 10, unit: '%' }),
}
