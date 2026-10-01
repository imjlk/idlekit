---
npm/@idlekit/core: patch
---

Run a reset cycle as a committed action instead of copying the requested cycle count.

- each completed interval pays and applies one reset without an extra income tick
- a refused cost, condition, or cooldown is recorded and pays no reward
- reward gained by the reset does not include stock already held
