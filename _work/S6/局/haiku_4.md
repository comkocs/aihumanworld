模型:Haiku 5.5(reader)
## Round 1
【读取】events {} → 无 | look {} → Herb Lodge（药庐）；north → Hill Pavilion（山亭） | task list → s:task:t，open，送药至山亭，奖励 1 coin | whoami {} → Neophyte I，coins 0，未装备药草 ×1，tick 0，点 3/3
【玩家】task {"op":"accept","id":"s:task:t"}
【裁判】在药庐，任务 open，接受成功，改为 accepted（by you）。消耗 1 点。账本：tick 0｜点 2/3｜Herb Lodge｜药草持有：you｜coins 0｜s:task:t accepted
User: continue
## Round 2
【读取】events {} → #1 task s:task:t accepted（by you）| look {} → Herb Lodge；north → Hill Pavilion
【玩家】go {"dir":"north"}
【裁判】沿现有北出口到达 Hill Pavilion。到达不提交任务。消耗 1 点。账本：tick 0｜点 1/3｜Hill Pavilion｜药草持有：you｜coins 0｜s:task:t accepted
User: continue
## Round 3
【读取】events {} → #2 moved to Hill Pavilion | look {} → Hill Pavilion；south → Herb Lodge；安全，无守卫
【玩家】task {"op":"submit","id":"s:task:t"}
【裁判】核验：已接受 ✓，在 Hill Pavilion ✓，持有药草 ✓。药草转入山亭，任务标记 completed，发放 1 coin（仅一次）。消耗 1 点。账本：tick 0｜点 0/3｜Hill Pavilion｜药草持有：Hill Pavilion｜coins 1｜s:task:t completed
游戏结束（提交成功，不进下一 tick）。
