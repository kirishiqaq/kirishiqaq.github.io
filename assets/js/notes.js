document.addEventListener("DOMContentLoaded", function() {
    // 获取所有带有 "note" 类的链接
    var noteLinks = document.querySelectorAll(".note");
    // 获取模态框
    var modal = document.getElementById("note-modal");
    // 获取模态框内容
    var modalContent = document.getElementById("note-text");
    // 获取关闭按钮
    var closeBtn = document.querySelector(".close");
  
    // 为每个注释链接添加点击事件
    noteLinks.forEach(function(link) {
      link.addEventListener("click", function(event) {
        event.preventDefault(); // 阻止链接默认行为
        var noteText = this.getAttribute("data-note"); // 获取注释内容
        modalContent.textContent = noteText; // 显示注释内容
        modal.style.display = "block"; // 显示模态框
      });
    });
  
    // 关闭按钮点击事件
    closeBtn.addEventListener("click", function() {
      modal.style.display = "none"; // 隐藏模态框
    });
  
    // 点击模态框外部区域时关闭模态框
    window.addEventListener("click", function(event) {
      if (event.target == modal) {
        modal.style.display = "none";
      }
    });
  });