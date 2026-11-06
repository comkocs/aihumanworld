模型：GLM-5.3 Flash(reader-glmflash)

## 第 1 轮
玩家·读(0点):events {}→无新增；look {}→药庐，出口north→山亭，安全；task {"op":"list"}→s:task:t(open,送药到山亭，赏1币);whoami {}→练气初期，币0,持药草×1。
玩家:task {"op":"accept","id":"s:task:t"}
裁判：在药庐且open→accepted。刻0,点3→2;药草随身，币0。
停。

用户：继续

## 第 2 轮
玩家·读(0点):events {}→无新增；look {}→仍在药庐，出口north→山亭。
玩家:go {"dir":"north"}
裁判：沿出口北行→山亭(南返药庐)，安全。刻0,点2→1;在山亭，持药草，币0,任务accepted。
停。

用户：继续

## 第 3 轮
玩家·读(0点):events {}→无新增；look {}→在山亭，出口south→药庐。
玩家：task {"op":"submit","id":"s:task:t"}
裁判：已接、在山亭、持药草→药草移至山亭,s:task:t改completed,币0→1。本局结束。
