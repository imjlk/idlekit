@tool
class_name IdlekitEconomy
extends Resource
## Economy parameters exported by `idk export engine --target godot`.
##
## The `.tres` file sets every property below. Regenerate it from the
## idlekit scenario instead of editing the numbers by hand.

@export var format_version: int = 1
@export var scenario_id: String = ""
@export var title: String = ""
@export var scenario_hash: String = ""
@export var unit_code: String = ""
@export var unit_symbol: String = ""
@export var model_id: String = ""
@export var model_version: int = 1
@export var step_sec: float = 1.0
@export var duration_sec: float = 0.0
@export var initial_wallet: float = 0.0
@export var initial_vars: Dictionary = {}
@export var prestige_multiplier: float = 1.0
## Model parameters by key, for example `buyCostBase`.
@export var parameters: Dictionary = {}
## Curve descriptions: `id`, `kind`, `variable`, `base`, `growth` or `perUnit`, `formula`.
@export var curves: Array = []
@export var level_variable: String = ""
## Price of the next unit at each level, from idlekit.
@export var cost_table: PackedFloat64Array = PackedFloat64Array()
## Income per second at each level, before prestige.
@export var income_table: PackedFloat64Array = PackedFloat64Array()


func find_curve(id: String) -> Dictionary:
	for curve in curves:
		if curve.get("id", "") == id:
			return curve
	return {}


## Price of the next unit when `level` units are owned. Uses the table, then the curve.
func cost_at(level: int) -> float:
	if level >= 0 and level < cost_table.size():
		return cost_table[level]
	var curve := find_curve("buy.generator.cost")
	if curve.is_empty():
		return INF
	return float(curve["base"]) * pow(float(curve["growth"]), level)


## Income per second when `level` units are owned.
func income_at(level: int, multiplier: float = 1.0) -> float:
	if level >= 0 and level < income_table.size():
		return income_table[level] * multiplier
	var curve := find_curve("income")
	if curve.is_empty():
		return 0.0
	return (float(curve["base"]) + float(curve["perUnit"]) * level) * multiplier


## Build an economy from `idk export engine --target godot --file-format json`.
static func from_json_file(path: String) -> IdlekitEconomy:
	var text := FileAccess.get_file_as_string(path)
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("Not an idlekit Godot JSON export: %s" % path)
		return null
	var economy := IdlekitEconomy.new()
	for key in data.keys():
		if key == "cost_table" or key == "income_table":
			economy.set(key, PackedFloat64Array(data[key]))
		else:
			economy.set(key, data[key])
	return economy
