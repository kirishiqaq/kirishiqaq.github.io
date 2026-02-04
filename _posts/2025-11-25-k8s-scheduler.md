---
layout: post
title:  "k8s-scheduler调度规则"
date:   2025-11-25 11:00:00 +0800--
categories: [技术杂谈]
tags:   [k8s]
---
在 Kubernetes 项目中，默认调度器的主要职责，就是为一个新创建出来的 Pod，寻找一个最合适的节点（Node）。

从集群所有的节点中，根据调度算法挑选出所有可以运行该 Pod 的节点

从第一步的结果中，再根据调度算法挑选一个最符合条件的节点作为最终结果。

预选，优选，绑定三个阶段

## 预选阶段

Kubernetes 中，默认的调度策略有如下三种：

### 第一种类型，叫作 GeneralPredicates。

PodFitsResources 计算的就是宿主机的 CPU 和内存资源等是否够用，PodFitsResources 检查的只是 Pod 的 requests 字段

PodFitsHost 检查的是，宿主机的名字是否跟 Pod 的 spec.nodeName 一致。这里应该指的是pod中已指定的spec.nodeName

PodFitsHostPorts 检查的是，Pod 申请的宿主机端口（spec.nodePort）是不是跟已经被使用的端口有冲突。

PodMatchNodeSelector 检查的是，Pod 的 nodeSelector 或者 nodeAffinity 指定的节点，是否与待考察节点匹配，等等。

### 第二种类型，是与 Volume 相关的过滤规则。

NoDiskConflict 检查的条件，是多个 Pod 声明挂载的持久化 Volume 是否有冲突

MaxPDVolumeCountPredicate 检查的条件，则是一个节点上某种类型的持久化 Volume 是不是已经超过了一定数目

VolumeZonePredicate，则是检查持久化 Volume 的 Zone（高可用域）标签，是否与待考察节点的 Zone 标签相匹配。

VolumeBindingPredicate 的规则。它负责检查的，是该 Pod 对应的 PV 的 nodeAffinity 字段，是否跟某个节点的标签相匹配。

### 第三种类型，是宿主机相关的过滤规则。

PodToleratesNodeTaints，负责检查的就是我们前面经常用到的 Node 的“污点”机制。

NodeMemoryPressurePredicate，检查的是当前节点的内存是不是已经不够充足，如果是的话，那么待调度 Pod 就不能被调度到该节点上。

### 第四种类型，是 Pod 相关的过滤规则。

这一组规则，跟 GeneralPredicates 大多数是重合的。而比较特殊的，是 PodAffinityPredicate。这个规则的作用，是检查待调度 Pod 与 Node 上的已有 Pod 之间的亲密（affinity）和反亲密（anti-affinity）关系

上面这四种类型的 Predicates，就构成了调度器确定一个 Node 可以运行待调度 Pod 的基本策略。在具体执行的时候， 当开始调度一个 Pod 时，Kubernetes 调度器会同时启动 16 个 Goroutine，来并发地为集群里的所有 Node 计算 Predicates，最后返回可以运行这个 Pod 的宿主机列表。


## 优选阶段

在 预选 阶段完成了节点的“过滤”之后，Priorities 阶段的工作就是为这些节点打分。这里打分的范围是 0-10 分，得分最高的节点就是最后被 Pod 绑定的最佳节点。

1、最常用到的一个打分规则，是 LeastRequestedPriority。它的计算方法，可以简单地总结为如下所示的公式：

```
score = (cpu((capacity-sum(requested))10/capacity) + memory((capacity-sum(requested))10/capacity))/2
```

2、LeastRequestedPriority 一起发挥作用的，还有 BalancedResourceAllocation。它的计算公式如下所示：

```
score = 10 -variance(cpuFraction,memoryFraction,volumeFraction)*10
```

其中，每种资源的 Fraction 的定义是 ：Pod 请求的资源 / 节点上的可用资源。而 variance 算法的作用，则是计算每两种资源 Fraction 之间的“距离”。而最后选择的，则是资源 Fraction 差距最小的节点。所以说，BalancedResourceAllocation 选择的，其实是调度完成后，所有节点里各种资源分配最均衡的那个节点，从而避免一个节点上 CPU 被大量分配、而 Memory 大量剩余的情况。

3、NodeAffinityPriority、TaintTolerationPriority 和 InterPodAffinityPriority 这三种 Priority。顾名思义，它们与前面的 PodMatchNodeSelector、PodToleratesNodeTaints 和 PodAffinityPredicate 这三个 Predicate 的含义和计算方法是类似的。但是作为 Priority，一个 Node 满足上述规则的字段数目越多，它的得分就会越高。

4、在默认 Priorities 里，还有一个叫作 ImageLocalityPriority 的策略。它是在 Kubernetes v1.12 里新开启的调度规则，即：如果待调度 Pod 需要使用的镜像很大，并且已经存在于某些 Node 上，那么这些 Node 的得分就会比较高。当然，为了避免这个算法引发调度堆叠，调度器在计算得分的时候还会根据镜像的分布进行优化，即：如果大镜像分布的节点数目很少，那么这些节点的权重就会被调低，从而“对冲”掉引起调度堆叠的风险。

### 调度源码

![](/images/post20251125/img.png)


1、UpdateNodeNameToInfoMap根据node的cache更新信息，如果node已被移除，则将map的对应节点信息删掉，如果map中不存在节点的信息，将该节点的信息集合加入map中，这些信息集合运用于后期的pod调度的逻辑判断，对于么个节点，这些信息包括:

    a、节点的node资源信息；

    b、在该节点上的pod请求和可分配的资源总和，包括cpu、内存、gpu、容许的pod总数、存储等；

    c、内存、磁盘压力情况；

    d、节点上的占用端口；

    e、Pod的亲和性；

    f、节点taints容忍性；


2、findNodesThatFit是schedule的预选，该函数根据配置的 Predicates Policies会返回一组符合Policies的nodes，最后将这组nodes作为优选的输入。如果经过预选后返回的节点只有一个，那么直接将该节点的名称返回，如果多余1个，将继续优选。

priorityMetaProducer获取pod effect为空或者为PreferNoSchedule，将toleration加入toleration列表，获取selector与pod相关的rc、rs、service加入到selector列表。获取pod中container请求的cpu、内存大小综合，如果container未设定，cpu默认为100，内存默认为209715200。

获取pod的亲和性。

关于PreferNoSchedule、NoSchedule、NoExecute的介绍如下：

对比一个 node 上所有的 taints，忽略掉和 pod 中 toleration 匹配的 taints，遗留下来未被忽略掉的所有 taints 将对 pod 产生 effect。

    a、至少有 1 个未被忽略的 taint 且 effect 是 NoSchedule 时，则 k8s 不会将该 pod 调度到这个 node 上

    b、不满足上述场景，但至少有 1 个未被忽略的 taint 且 effect 是 PreferNoSchedule 时，则 k8s 将尝试不把该 pod 调度到这个 node 上

    c、至少有 1 个未被忽略的 taint 且 effect 是 NoExecute 时，则 k8s 会立即将该 pod 从该 node 上驱逐（如果已经在该 node 上运行），或着不会将该 pod 调度到这个 node 上（如果还没在这个 node 上运行）


## 总结

调度会获取pod中container请求的cpu、内存大小，如果container未设定，cpu默认为100，内存默认为209715200,建议合理设置resource request/limit,防止调度不均，节点热度不同的问题

