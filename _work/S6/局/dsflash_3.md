模型:DeepSeek Flash(reader-dsflash)

## 第 1 轮
玩家：`whoami {}`、`events {}`、`look {}`；`task {"op":"accept","id":"s:task:t"}`。
裁判：whoami 练气初期、币0、持药草；events 无新增；look 药庐，出口 north 通山亭；接单成功（在药庐且 open），任务转 accepted，扣1点，余2点；刻0、地点药庐、药草在身、币0。

用户:继续

## 第 2 轮
玩家：`events {}`、`look {}`；`go {"dir":"north"}`。
裁判：events 无新增；look 药庐，出口 north；走 north 成功，地点移山亭，出口 south 返药庐；扣1点，余1点；刻0、任务 accepted、药草在身、币0。

用户:继续

## 第 3 轮
玩家：`events {}`、`look {}`；`task {"op":"submit","id":"s:task:t"}`。
裁判：events 无新增；look 山亭，出口 south；交单前提满足（已接、在山亭、持药草）：药草移至山亭，任务 completed，币+1=1，扣1点，余0点；刻0。本局结束。
