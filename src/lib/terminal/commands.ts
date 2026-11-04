/** Command catalogue for the inline completion list. */
export interface CommandInfo {
  name: string;
  desc: string;
  /** Short forms / common aliases shown in the hint, counted with the canonical name. */
  aliases?: string[];
}

export const LINUX_COMMANDS: CommandInfo[] = [
  { name: "ls", desc: "列出目录内容", aliases: ["ll", "la", "dir"] },
  { name: "cd", desc: "切换目录", aliases: ["chdir"] },
  { name: "pwd", desc: "显示当前所在目录" },
  { name: "cat", desc: "查看文件内容", aliases: ["type"] },
  { name: "less", desc: "分页查看文件", aliases: ["more"] },
  { name: "head", desc: "查看文件开头几行" },
  { name: "tail", desc: "查看文件结尾，可跟踪日志" },
  { name: "grep", desc: "按内容搜索文本", aliases: ["egrep", "fgrep", "rg"] },
  { name: "awk", desc: "按列处理文本" },
  { name: "sed", desc: "流式文本替换/编辑" },
  { name: "sort", desc: "排序文本行" },
  { name: "uniq", desc: "去除相邻重复行" },
  { name: "wc", desc: "统计行数/字数/字节" },
  { name: "cut", desc: "按列截取文本" },
  { name: "tr", desc: "字符替换/删除" },
  { name: "tee", desc: "输出同时写入文件" },
  { name: "xargs", desc: "把输入作为命令参数" },
  { name: "find", desc: "按条件查找文件" },
  { name: "locate", desc: "从索引快速查找文件" },
  { name: "which", desc: "查看命令所在路径" },
  { name: "whereis", desc: "查找命令及其手册位置" },
  { name: "file", desc: "识别文件类型" },
  { name: "stat", desc: "查看文件详细元数据" },
  { name: "du", desc: "统计目录占用空间", aliases: ["duf"] },
  { name: "df", desc: "查看磁盘使用情况" },
  { name: "free", desc: "查看内存使用情况" },
  { name: "top", desc: "实时查看进程与资源" },
  { name: "htop", desc: "交互式进程查看器" },
  { name: "ps", desc: "查看进程列表" },
  { name: "pgrep", desc: "按名称查找进程 PID" },
  { name: "kill", desc: "按 PID 结束进程" },
  { name: "killall", desc: "按名称结束进程" },
  { name: "pkill", desc: "按模式结束进程" },
  { name: "systemctl", desc: "管理系统服务", aliases: ["service", "journalctl", "systemd-analyze"] },
  { name: "journalctl", desc: "查看系统日志（journalctl -u 服务）" },
  { name: "tar", desc: "打包或解包归档" },
  { name: "zip", desc: "创建 zip 压缩包" },
  { name: "unzip", desc: "解压 zip 文件" },
  { name: "gzip", desc: "gzip 压缩/解压" },
  { name: "xz", desc: "xz 压缩/解压" },
  { name: "cp", desc: "复制文件或目录" },
  { name: "mv", desc: "移动或重命名" },
  { name: "rm", desc: "删除文件或目录" },
  { name: "mkdir", desc: "创建目录" },
  { name: "rmdir", desc: "删除空目录" },
  { name: "touch", desc: "创建空文件或更新时间戳" },
  { name: "ln", desc: "创建硬链接或符号链接" },
  { name: "chmod", desc: "修改文件权限", aliases: ["chgrp"] },
  { name: "chown", desc: "修改文件属主与属组" },
  { name: "umask", desc: "查看或设置默认权限掩码" },
  { name: "useradd", desc: "新增用户", aliases: ["adduser"] },
  { name: "usermod", desc: "修改用户属性" },
  { name: "userdel", desc: "删除用户", aliases: ["deluser"] },
  { name: "passwd", desc: "修改用户密码" },
  { name: "su", desc: "切换用户", aliases: ["sudo"] },
  { name: "ssh", desc: "远程登录其他主机", aliases: ["ssh-copy-id"] },
  { name: "scp", desc: "在主机间复制文件" },
  { name: "rsync", desc: "增量同步文件" },
  { name: "curl", desc: "发起 HTTP 请求 / 下载" },
  { name: "wget", desc: "下载文件" },
  { name: "ping", desc: "测试网络连通性" },
  { name: "traceroute", desc: "查看路由路径", aliases: ["tracepath"] },
  { name: "ip", desc: "查看/配置网络接口", aliases: ["ifconfig", "ipconfig"] },
  { name: "ss", desc: "查看端口监听与连接", aliases: ["netstat"] },
  { name: "nslookup", desc: "查询域名解析", aliases: ["dig", "host"] },
  { name: "iptables", desc: "配置 iptables 规则", aliases: ["firewall-cmd", "ufw"] },
  { name: "docker", desc: "容器管理", aliases: ["docker-compose", "podman"] },
  { name: "kubectl", desc: "管理 Kubernetes 集群", aliases: ["k"] },
  { name: "nginx", desc: "启动/检查 Nginx" },
  { name: "mysql", desc: "MySQL 客户端", aliases: ["mariadb"] },
  { name: "redis-cli", desc: "Redis 客户端" },
  { name: "psql", desc: "PostgreSQL 客户端" },
  { name: "git", desc: "版本控制" },
  { name: "vim", desc: "文本编辑器", aliases: ["vi", "nvim"] },
  { name: "nano", desc: "简易文本编辑器" },
  { name: "emacs", desc: "可扩展文本编辑器" },
  { name: "crontab", desc: "定时任务管理", aliases: ["cron"] },
  { name: "date", desc: "显示或设置时间" },
  { name: "uptime", desc: "查看运行时长与负载" },
  { name: "w", desc: "查看登录用户及其活动" },
  { name: "who", desc: "查看登录用户" },
  { name: "whoami", desc: "显示当前用户名" },
  { name: "id", desc: "查看当前用户 UID/GID/组" },
  { name: "history", desc: "查看命令历史" },
  { name: "env", desc: "查看环境变量", aliases: ["printenv"] },
  { name: "export", desc: "设置环境变量" },
  { name: "alias", desc: "查看/定义命令别名", aliases: ["unalias"] },
  { name: "clear", desc: "清屏", aliases: ["reset"] },
  { name: "exit", desc: "退出当前 shell", aliases: ["logout"] },
  { name: "echo", desc: "输出文本或变量" },
  { name: "printf", desc: "格式化输出" },
  { name: "read", desc: "读取标准输入" },
  { name: "source", desc: "在当前 shell 执行脚本", aliases: ["."] },
  { name: "bash", desc: "启动 Bash shell", aliases: ["sh", "zsh"] },
  { name: "nohup", desc: "忽略挂断信号后台运行" },
  { name: "screen", desc: "终端复用（会话保持）", aliases: ["tmux"] },
  { name: "watch", desc: "周期性执行并显示结果" },
  { name: "time", desc: "统计命令耗时" },
  { name: "diff", desc: "比较两个文件的差异", aliases: ["vimdiff"] },
  { name: "md5sum", desc: "计算/校验 MD5", aliases: ["sha256sum"] },
  { name: "base64", desc: "Base64 编解码" },
  { name: "openssl", desc: "加解密与证书工具" },
  { name: "lsof", desc: "查看进程打开的文件/端口" },
  { name: "strace", desc: "跟踪系统调用" },
  { name: "dmesg", desc: "查看内核日志" },
  { name: "mount", desc: "挂载/查看文件系统", aliases: ["umount"] },
  { name: "lsblk", desc: "查看块设备与分区" },
  { name: "fdisk", desc: "磁盘分区工具", aliases: ["parted"] },
  { name: "nc", desc: "网络调试（netcat）", aliases: ["telnet", "socat"] },
  { name: "tcpdump", desc: "抓包分析" },
  { name: "hostname", desc: "查看/设置主机名" },
  { name: "uname", desc: "查看内核与系统信息" },
  { name: "hostnamectl", desc: "查看/设置主机信息" },
  { name: "lsb_release", desc: "查看发行版版本" },
];

/** Maps an alias to its canonical command name. */
export function canonicalCommand(name: string): string | null {
  const lower = name.toLowerCase();
  for (const command of LINUX_COMMANDS) {
    if (command.name === lower) {
      return command.name;
    }
    if (command.aliases?.includes(lower) === true) {
      return command.name;
    }
  }
  return null;
}

/** Description text with aliases appended, e.g. "列出目录内容（简写：ll / la）". */
export function describeCommand(command: CommandInfo): string {
  if (command.aliases === undefined || command.aliases.length === 0) {
    return command.desc;
  }
  return `${command.desc}（简写：${command.aliases.slice(0, 3).join(" / ")}）`;
}
