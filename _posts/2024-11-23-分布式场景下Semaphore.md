---
layout: post
title:  "分布式场景下的Semaphore"
date:   2024-11-23 12:00:00 +0800--
categories: [技术杂谈]
tags:   [Redis]
---
像单机中Semaphore控制一定数量的并发

如果需要定时任务把一个库中数据迁移到另一个库中去

![](/images/post20241123/img.png)
    
    1.任务在一台机器上只能同时运行一次任务。（正常情况下，一台机器在任务间隔时间内能够执行成功任务。如果机器宕机等问题导致任务失败，应该换台机器执行）

    2.对于能够同时访问数据库资源不会出现并发问题的情况，可以允许多台机器同时运行。如果有并发冲突，那么只能有一台机器同时访问。（比如一台机器由于网络等原因执行较慢，可以由另一台机器同时执行）

A库的数据库资源，然后插入B库，如果在一定的时间内没有执行成功，另外一台机器继续执行任务也并非不可。重复插入的DuplicateKeyException忽略掉即可。

需要对同一台机器上锁，也可以允许多台机器并行，也即在分布式场景下实现Semaphore

常见的redis加锁流程如下：

```
try{
   redis+lua加锁;
}catch(Exception e){
//异常处理;
}finally{
   //释放锁;
}

```

需要加锁的是资源，如果一台机器加锁了，不能再次加锁，就需要标识机器的ip，可以和占有的资源对应起来。

![](/images/post20241123/img_1.png)

```commandline
     String script = "local resourceName = KEYS[1]\n" +
                    "local listKey = resourceName .. "|list" +
                    "local mapKey = resourceName .. \"|map\"\n" +
                    "local ip= ARGV[1]\n" +
                    "local resourceCount = tonumber(ARGV[2])\n" +
                    "\n" +
                    "local mapIndex = redis.call('hget', mapKey, ip)\n" +
                    "if mapIndex ~= false then\n" +
                    "    return 0\n" +
                    "end\n" +
                    "local mapLen = redis.call('hlen', mapKey)\n" +
                    "if mapLen >= resourceCount then\n" +
                    "    return -1\n" +
                    "end\n" +
                    "local listLen = redis.call('llen', listKey)\n" +
                    "local currentTotalCount = mapLen + listLen\n" +
                    "if currentTotalCount < resourceCount then\n" +
                    "    local valueList = {}\n" +
                    "    for i = currentTotalCount + 1, resourceCount do\n" +
                    "        valueList[i - currentTotalCount] = i\n" +
                    "    end\n" +
                    "    redis.call('rpush', listKey, unpack(valueList))\n" +
                    "end\n" +
                    "local curIndex = redis.call('lpop', listKey)\n" +
                    "redis.call('hset', mapKey, ip, tonumber(curIndex))\n" +
                    "return tonumber(curIndex)";
                    
                    
     long lockRes = (long) cacheClusterClient.eval(script, key, ip, String.valueOf(resourceCount));   //加锁
```
通过redis的哈希和列表数据类型。 list中是可用资源数量，hash中是<ip,资源名称>,从而达到对任务对应的ip加锁的情况下，通过传入资源数量来控制最大的并发数，如果资源数量是1，那么就保证了互斥性。

解锁流程:
```commandline
     String script = "local resourceName = KEYS[1]\n" +
                    "local listKey = resourceName .. \"|list\"\n" +
                    "local mapKey = resourceName .. \"|map\"\n" +
                    "local ip= ARGV[1]\n" +
                    "\n" +
                    "local mapIndex = redis.call('hget', mapKey, ip)\n" +
                    "if mapIndex == false then\n" +
                    "    return -1\n" +
                    "end\n" +
                    "redis.call('hdel', mapKey, ip)\n" +
                    "redis.call('rpush', listKey, tonumber(mapIndex))\n" +
                    "return 1";
                    
      long unlockRes = (long) cacheClusterClient.eval(script, key, ip);
```

如果机器突然宕机，那么finally中的代码无法释放锁，有多个共享资源，则可以在别的机器上成功执行

相比DRC处理持续性的数据复制场景，作为是周期性、批量的数据迁移任务这也昂处理可能更灵活
