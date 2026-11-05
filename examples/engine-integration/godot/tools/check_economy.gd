## Headless check that the exported resource loads.
##   godot --headless --path examples/engine-integration/godot --script res://tools/check_economy.gd
extends SceneTree


func _init() -> void:
	var economy := load("res://data/cafe_economy.tres") as IdlekitEconomy
	if economy == null:
		push_error("cafe_economy.tres did not load as IdlekitEconomy")
		quit(1)
		return
	print("scenario=%s model=%s@%d" % [economy.scenario_id, economy.model_id, economy.model_version])
	print("cost_at(0)=%s cost_at(10)=%s income_at(10)=%s" % [economy.cost_at(0), economy.cost_at(10), economy.income_at(10)])
	print("parameters=%s" % [economy.parameters])
	var from_json := IdlekitEconomy.from_json_file("res://data/cafe_economy.json")
	if from_json == null or from_json.cost_table.size() != economy.cost_table.size():
		push_error("cafe_economy.json and cafe_economy.tres disagree")
		quit(1)
		return
	quit(0)
