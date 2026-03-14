idk init scenario --track personal --preset builder --out ./my-game-v1.json --name "Space Miner"
idk validate ./space-miner-v1.json
idk simulate ./space-miner-v1.json --format json
idk experience ./space-miner-v1.json --format json
