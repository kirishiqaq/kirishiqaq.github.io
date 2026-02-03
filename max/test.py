import os

# 获取当前目录下的所有文件
files = os.listdir()

# 遍历所有文件并进行处理
for filename in files:
    # 只处理png格式的图片
    if filename.endswith(".png"):
        # 判断文件名中是否包含“[原始大小]”字样
        if " " in filename:
            # 去掉文件名中的“[原始大小]”字样
            new_filename = filename.replace(" ", "")
            # 重命名文件
            os.rename(filename, new_filename)
            print(f"{filename}已经更名为{new_filename}")
