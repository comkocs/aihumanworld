模型:GLM-5.3 Flash(reader-glmflash)

## 第 1 轮
玩家:events{}→无新事件;look{}→药庐,出口北;task{"op":"list"}→s:task:t(open)送药到山亭,奖1币
玩家:task{"op":"accept","id":"s:task:t"}
裁判:接单成功。刻0,余2点;药庐;币0;药草随身;s:task:t=accepted

用户:继续

## 第 2 轮
玩家:events{}→无新事件;look{}→药庐,出口北
玩家:go{"dir":"north"}
裁判:北行至山亭。刻0,余1点;山亭;币0;药草随身;s:task:t=accepted

用户:继续

## 第 3 轮
玩家:events{}→无新事件;look{}→山亭,出口南
玩家:task{"op":"submit","id":"s:task:t"}
裁判:前提符合(已接、在山亭、持未装备药草)。药草移至山亭,s:task:t=completed,币+1=1。刻0,余0点。本局结束
