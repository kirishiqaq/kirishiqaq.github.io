---
layout: post
title:  "Pin,Unpin"
date:   2025-11-02 11:00:00 +0800--
categories: [技术杂谈]
tags:   [Rust]
---
Pin 是 Rust 中用于安全处理“自引用类型”的机制。自引用类型（如某些 Future）包含指向自身数据的指针，移动这类对象会导致指针失效，引发内存安全问题。
Pin 通过包装指针来防止其指向的值被移动，而 Unpin trait 标记的类型可以安全移动，大多数类型自动实现 Unpin。
使用 pin-project 库可以安全地访问被 Pin 包裹的结构体字段，避免手写 unsafe 代码。<br>
如要创建一个 TimedWrapper Future，能够测量任何异步函数的执行时间，那么其理想的用法应该是下面这样：<br>
```rust
let async_fn = reqwest::get("http://adamchalmers.com");
let timed_async_fn = TimedWrapper::new(async_fn);
let (resp, time) = timed_async_fn.await;
```
在底层，Rust 的 async 函数其实就是普通的函数，只不过它们都会返回 Future。<br>
Future trait定义了一个可轮询类型的标准：<br>
- 轮询，可通过 poll 方法查询状态<br>
- 状态分为Pending或Ready<br>
- 若为 Pending，需后续继续轮询<br>
- 若为 Ready，则输出结果值，此过程称为Resolving<br>
在实现poll方法时，遇到了编译错误：<br>
```rust

pub struct TimedWrapper<Fut: Future> {
  start: Option<Instant>,
  future: Fut,
}
```

TimedWrapper 通过接受一个类型 Fut 来实现泛型，并且这个类型必须是 Future。
然后它会把这个 future 保存在一个字段里。同时，它还有一个叫做 start 的字段来记录第一次被 poll 的时间。构造方法：<br>
```rust
impl<Fut: Future> TimedWrapper<Fut> {
    pub fn new(future: Fut) -> Self {
        Self { future, start: None }
    }
}
```
为了让它可以被 .await，需要实现也就是 Future 唯一需要实现的poll方法。<br>
```rust
impl<Fut: Future> Future for TimedWrapper<Fut> {
// 这个 future 会输出一对值：
// 1. 内部 future 的输出
// 2. 内部 future 解析所消耗的时间
type Output = (Fut::Output, Duration);

    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output> {
        let start = self.start.get_or_insert_with(Instant::now);
        let inner_poll = self.future.poll(cx);
        let elapsed = self.elapsed();

        match inner_poll {
            Poll::Pending => Poll::Pending,
            Poll::Ready(output) => Poll::Ready((output, elapsed)),
        }
    }
}


```
此时会出现这样的报错:<br>
```rust
  // 错误：no method named `poll` found for type parameter `Fut` in the current scope
  self.future.poll(cx)  
```
虽然 Fut 没有 poll 方法，但是 Pin<&mut Fut> 有, 原因：Future 的 poll 方法接收 Pin<&mut Self>，而不是普通 &mut self。<br>
明确：Pin 存在是为了解决一个特定的问题：自指类型，也就是包含有指向了自身的指针的类型。<br>
举例，一个二叉查找树可能含有一个自指的指针，指向了同一棵树下的另一个节点。<br>
![](/images/post251102/img.png)
pointer 字段指向在内存地址 A 的 val 字段，存有一个有效的 i32。这些指针都是 有效的 ，意味着这些指针所指向的内存确实可以被转换成正确的类型（在这里是 i32）。但是 Rust 编译器经常会把值在内存中四处移动。举个栗子，如果我们把这个结构体传到了某个函数里，它可能会被移动到一个不同的内存地址，或者装箱放到堆内存上，或者这个函数被存放在 Vec<MyStruct> 中。当想要往这个 Vec 里放更多值的时候，它可能会超出容量并把元素移动到一个新的，更大的缓冲区里。<br>
![](/images/post251102/img1.png)
移动时，结构体字段的地址会被改变，但值不会。因此 pointer 字段仍然指向原来的地址 A，但地址 A 现在不再存有一个有效的 i32。那里原有的数据被移动到了地址 B，而且某些新的数据可能被写入到了地址 A，于是指针不再有效。在最好的情况下，无效的指针会引起程序崩溃，而最坏的情况下这可能会变成一个可破解的漏洞。尽量保证这类内存不安全的代码存在 unsafe 块内，在移动后及时更新指针。<br>
有了pinned结构体，可以使用一些助手函数拿到对字段的引用。如普通的 Rust 引用，像 &mut，或者是 pinned。这被称之为 “投影” (projection)：如果有一个 pinned 结构体，就可以写一个投影方法来访问到它的所有字段。<br><br>
简单总结，何时需要关心 Pin/Unpin？<br>
- 实现自定义 Future（特别是包装其他 Future）     <br>
- 处理自引用数据结构   <br>
- 编写低级异步运行时 <br>

常用模式总结<br>
情况1：Unpin 类型（简单情况）<br>
```rust
// 大部分情况，直接使用即可
let mut value: i32 = 42;
let pinned = Pin::new(&mut value);  // 安全：i32 是 Unpin
```
情况2：!Unpin 类型（异步/自引用）   <br>
```rust
// 使用 pin-project 简化
#[pin_project]
struct MyAsyncType {
    #[pin]
    inner_future: impl Future,
    // 其他普通字段...
}
```
情况3：通用代码（处理未知类型）<br>
```rust
fn process_future<F: Future + ?Unpin>(future: Pin<&mut F>) {
    // ?Unpin 表示 "可能不是 Unpin"
    // 使用投影或适当的方法处理
}
```

