---
layout: post
title:  "Elasticsearch Collapse | 组合查询"
date:   2025-09-11 12:00:00 +0800--
categories: [技术杂谈]
tags:   [ES]
---
# Collapse
在 Elasticsearch 中，collapse 参数用于根据特定字段对搜索结果进行**去重折叠**，仅返回每个字段值匹配的**第一个文档**（或按规则排序后的最优文档）。这一功能常用于排除重复数据或按分组展示结果，类似于 SQL 中的 DISTINCT。

## 一、Collapse 的核心作用

1.去重折叠根据指定字段（如 cat_id）折叠相同值的文档，确保结果中每个分组仅返回一个代表文档。

2.保留上下文支持通过 inner_hits 查看被折叠的其他文档。

## 二、基本语法

```
GET /index/_search
{
  "query": {
    "match_all": {}
  },
  "from":0,                        //折叠之后的文档的分页参数
  "size":10,                       //折叠之后的文档的分页参数
  "collapse": {
    "field": "field_name",         // 折叠依据的字段
    "inner_hits": {                // 可选：返回分组内其他文档
      "name": "most_recent",        // 自定义inner_hits名称
      "size": 5,                    // 返回每组最多文档数
      "sort": [{"field_name": "desc"}] // 分组内排序规则
      "_source": ["field_name"]        //子文档返回的字段
    },
    "max_concurrent_group_searches": 10 // 控制并发请求数（默认值：取决于分片数）；
  }
}
```

## 三、参数详解

### 1. `field`

•必填参数，指定折叠依据的字段。

•字段类型必须为 keyword 或数值类型（如 long），不支持 text 类型。

原因分析：

collapse功能依赖字段的 **精确值匹配，**而text类型字段在索引时会经过 **分词器（Analyzer）** 处理，将原始文本拆分为多个词项（Term）。分词后的词项是独立存储的，**原始完整值已丢失**。所以collapse无法对text类型字段进行操作。

### 2. `inner_hits`

•可选参数，返回分组内被折叠的文档详情。

•常用子参数：

◦name: 自定义结果中 inner_hits 的名称（默认生成随机名称）。

◦size: 每组返回的文档数量（默认返回前 3 个）。

◦sort: 定义分组内文档的排序规则（默认与主查询排序一致）。

### 3. `max_concurrent_group_searches`

•当使用 inner_hits 返回折叠组内的其他文档时，Elasticsearch 会为每个分组执行独立的子查询。此参数通过限制并发查询数，避免因分组过多导致资源耗尽（如 CPU、内存、文件句柄等）。

•控制并发请求数，避免资源耗尽。

•默认值由分片数决定，分组较多时可适当调高。

## 四、排序策略

•主排序：决定折叠后返回的代表文档（默认按相关性得分排序）。

•分组内排序：通过 inner_hits.sort 自定义（如按时间倒排）。

示例：优先返回高评分用户的最新文章

```

{
  "query": {"match_all": {}},
  "sort": [{"score": "desc"}],       // 主排序：按评分降序，也可指定其他字段排序
  "collapse": {
    "field": "catId",
    "inner_hits": {
      "sort": [{"docUpdateTime": "desc"}]  // 分组内按时间排序
    }
  }
}
```

## 五、作用域

#### 1. **对查询结果的作用域**

•核心逻辑：

◦collapse 的作用域是 整个查询结果，即它会在主查询（query）匹配的所有文档中，根据指定字段进行分组去重。

◦示例：若查询匹配 1000 个文档，collapse 按 user_id 折叠后，最终返回的文档数是不同 user_id 的数量（如 100 个用户）。

•执行阶段：

◦查询阶段：collapse 在查询阶段生效，会优化分片级别的处理（如仅返回每个分片内的分组代表文档）。

◦协调节点阶段：协调节点汇总各分片结果后，再次进行全局折叠，确保最终结果的唯一性。

#### 2. **对分页参数的作用域**

•分页逻辑：

◦from 和 size 参数的作用域是 折叠后的结果集。

◦示例：若 size:10，表示从折叠后的结果中取前 10 个文档，而非原始查询结果的前 10 个。

#### 3. **对排序的作用域**

•主排序（sort）：

◦sort 参数的作用域是 所有匹配文档，决定了每个分组的代表文档。

◦示例：若按 price:asc 排序，则每个分组中价格最低的文档会被选中。

◦默认排序：未指定 sort 时，按 _score（相关性得分）排序。

•分组内排序（inner_hits.sort）：

◦仅影响 inner_hits 返回的被折叠文档顺序，不影响代表文档的选择。

#### 4. **对聚合（Aggregations）的作用域**

•默认行为：

◦聚合操作的作用域是 原始查询结果（未折叠的文档）。

◦示例：若按 category 折叠后统计每个分类的文档数，聚合结果会包含所有文档（包括被折叠的文档）。

# 组合查询
Elasticsearch组合查询有以下几种：

1.bool Query，布尔查询，可以组合多个过滤语句来过滤文档。

2.boosting Query，在 positive 块中指定匹配文档的语句，同时降低在 negative 块中也匹配的文档的得分，提供调整相关性算分的能力。

3.constant_score Query，包装了一个过滤器查询，不进行算分。

4.dis_max Query，返回匹配了一个或者多个查询语句的文档，但只将最佳匹配的评分作为相关性算分返回。

5.function_score Query，支持使用函数来修改查询返回的分数。

## 一、Bool Query

bool Query 使用一个或者多个布尔查询子句进行构建，每个子句都有一个类型，这些类型如下：

1.must，查询的内容必须在匹配的文档中出现，并且会进行相关性算分。

2.filter，查询的内容必须在匹配的文档中出现，但不像 must，filter 的相关性算分是会被忽略的。因为其子句会在 filter context 中执行，所以其相关性算分会被忽略，并且子句将被考虑用于缓存。

3.should，查询的内容应该在匹配的文档中出现，可以指定最小匹配的数量。

4.must_not，查询的内容不能在匹配的文档中出现。与 filter 一样其相关性算分也会被忽略。

查询其示例如下：

```
POST standard/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "term": {
            "businessNo": {
              "value": "JDV013049074367"
            }
          }
        },
        {
          "term": {
            "isDelete": {
              "value": "1"
            }
          }
        }
      ]
    }
  }
}

```


如上示例，使用了 must 子句来查询。must 子句中包含了两个 term query，分别对业务单号和是否删除进行查询。

除了使用 must 子句外，还可以使用 filter 子句和 should 子句来做实现。should 子句有一个 minimum_should_match 参数，可以指定最少匹配的查询数量或者百分比。其示例如下

```
POST standard/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "term": {
            "businessNo": {
              "value": "JDV013049074367"
            }
          }
        },
        {
          "term": {
            "isDelete": {
              "value": "1"
            }
          }
        }
      ],
     "minimum_should_match": 2
    }
  }
}

```

如上示例，把子句改为 should，并且指定了 minimum_should_match 为 2，使得 should 子句中的查询必须命中两个或以上，这个文档才会被匹配。需要注意的是，当 Bool Query 包含至少一个 should 查询并且没有 must 、filter 的情况下，其值默认为 1，否则默认为 0

也可以使用 must 子句来查询业务单号，而使用 filter 子句来过滤是否删除，其示例如下：

```
POST standard/_search
{
"query":{
  
    "bool" : {
    "must" : [
      {
        "term" : {
          "businessNo" : {
            "value" : "JDV013049074367"
          }
        }
      }
    ],
    "filter" : [
      {
        "term" : {
          "isDelete" : {
            "value" : "1"
          }
        }
      }
    ]
    }
}
}

```

## 二、Boosting Query
boosting Query 可以指定两个块：positive 块和 negative 块。可以在 positive 块来指定匹配文档的语句，而在 negative 块中匹配的文档其相关性算分将会降低。相关性算分降低的程度将由 negative_boost 参数决定，其取值范围为：[0.0, 1.0]。

```
POST standard/_search
{
  "query": {
    "boosting": {
      "positive": {
        "term": {
          "sellerNo": {
            "value": "C190930001185"
          }
        }
      },
      "negative": {
        "term": {
          "buNo": {
            "value": "010K1298874"
          }
        }
      },
      "negative_boost": 0.5
    }
  }
}

```

如上示例，查询商家编码中含有 “C190930001185” 的数据，并且想让事业部编码为 “010K1298874” 的数据相关性降低一半。在 negative 块中匹配的文档，其相关性算分为：在 positive 中匹配时的算分 * negative_boost。

## 三、constant_score Query
constant_score Query包装 了一个过滤器查询，不进行算分。使用 Constant Score 可以将 query 转化为 filter，可以忽略相关性算分的环节，并且 filter 可以有效利用缓存，从而提高查询的性能。使用示例：

```
POST standard/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "range": {
          "expDate": {
            "gte": 1730390400000,
            "lte": 1731168000000
          }
        }
      }
    }
  }
}

```

如上示例，过滤出了业务日期大于等于2024-11-01 并且小于 2024-11-10 的数据。

﻿

## 四、dis_max Query

disjunction max query 简称 dis_max，是分离最大化查询的意思。

•disjunction（分离）的含义是：表示把同一个文档中的每个字段上的查询都分开，分别进行算分操作。

•max（最大化）: 是将多个字段查询的得分的最大值作为最终评分返回。

所以 disjunction max query 的效果是：将所有与任一查询匹配的文档作为结果返回，但是只将最佳匹配的得分作为查询的算分结果进行返回。

dis_max Query 的使用示例如下：

```
POST standard/_search
{
  "query": {
    "dis_max": {
      "queries": [
        {
          "term": {
            "sellerNo": {
              "value": "C190930001185"
            }
          }
        },
        {
          "term": {
            "buNo": {
              "value": "010K1298874"
            }
          }
        }
      ],
      "tie_breaker": 0.9
    }
  }
}

```

如上示例，查询商家编码为“C190930001185”或者事业部编码为"010K1298874“”，而最终返回的相关性评分将以匹配 “C190930001185” 或者匹配 “010K1298874” 中最大的那个评分为准。

在介绍 mutil-match 的时候也有一个 tie_breaker 参数。 当指定 “tie_breaker” 的时候，算分结果将会由以下算法来决定：

1.令算分最高的字段的得分为 s1

2.令其他匹配的字段的算分 * tie_breaker 的和为 s2

3.最终算分为：s1 + s2

“tie_breaker” 的取值范围为：[0.0, 1.0]。当其为 0.0 的时候，按照上述公式来计算，表示使用最佳匹配字段的得分作为相关性算分。当其为 1.0 的时候，表示所有字段的得分同等重要。当其在 0.0 到 1.0 之间的时候，代表其他字段的得分也需要参与到总得分的计算当中去。


## 五、function_score Query
function_score Query 允许你在查询结束以后去修改每一个匹配文档的相关性算分，所以使用算分函数可以改变或者替换原来的相关性算分结果。

function_score Query 提供了以下几种算分函数：

1.script_score：利用自定义脚本完全控制算分逻辑。

2.weight：为每一个文档设置一个简单且不会被规范化的权重。

3.random_score：为每个用户提供一个不同的随机算分，对结果进行排序。

4.field_value_factor：使用文档字段的值来影响算分，例如将好评数量这个字段作为考虑因数。

5.decay functions：衰减函数，以某个字段的值为标准，距离指定值越近，算分就越高。


## 六、总结

Bool Query 是使用的比较多的，Bool Query 提供了 must、filter、should、must_not 这几种类型来构建查询语句，其中 filter 与 must_not 的算分是会被忽略的。

Boosting Query 可以将部分匹配文档的得分进行降低，只需要在 negative 块中指定如何匹配文档即可，并且使用 negative_boost 参数来决定减小得分程度，其取值范围为：[0.0, 1.0]。

constant_score Query 可以将 query 转化为 filter，可以忽略相关性算分的环节，并且 filter 可以有效利用缓存，从而提高查询的性能。非常适合一些不需要算分的查询，例如精确值的查询、枚举量的查询等。

dis_max Query 是分离最大化查询的意思。其将所有与任一查询匹配的文档作为结果返回，但是只将最佳匹配的得分作为查询的算分结果进行返回。为了避免“一家独大”的情况，其他匹配的字段可以使用 “tie_breaker” 参数来进行“维权”。

function_score 是修改相关性算分的终极武器，它允许用户在查询结束以后去修改每一个匹配文档的相关性算分。


官方文档：[https://www.elastic.co/guide/en/elasticsearch/reference/7.13/compound-queries.html](https://www.elastic.co/guide/en/elasticsearch/reference/7.13/compound-queries.html)