# Real Linux SSH server used for LeonSSH acceptance tests.
#
#   docker build -t leonssh-sshd:test docker/sshd
#   docker run -d --name leonssh-sshd -p 2222:22 leonssh-sshd:test
#
# Credentials: test / test
# The host keys are generated at build time, so the fingerprint stays stable
# across container restarts (rebuilding the image changes it on purpose).
#
# Alpine keeps the image small and the apk mirror reachable from this network;
# `coreutils` is installed so `ls --color` behaves like a normal GNU system.

FROM docker.m.daocloud.io/library/alpine:3.20

ENV LANG=C.UTF-8 \
    TERM=xterm-256color

RUN set -eux; \
    printf '%s\n' \
      'https://mirrors.aliyun.com/alpine/v3.20/main' \
      'https://mirrors.aliyun.com/alpine/v3.20/community' \
      > /etc/apk/repositories; \
    apk add --no-cache \
      openssh-server \
      bash \
      coreutils \
      vim \
      htop \
      tmux \
      procps \
      less \
      ncurses-terminfo-base \
      tzdata; \
    mkdir -p /run/sshd /home/test; \
    adduser -D -s /bin/bash test; \
    echo 'test:test' | chpasswd; \
    ssh-keygen -q -t ed25519 -N '' -C 'leonssh-docker-sshd' -f /etc/ssh/ssh_host_ed25519_key; \
    ssh-keygen -q -t rsa -b 3072 -N '' -C 'leonssh-docker-sshd' -f /etc/ssh/ssh_host_rsa_key; \
    sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication yes/' /etc/ssh/sshd_config; \
    sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config; \
    sed -i 's/^AllowTcpForwarding .*/AllowTcpForwarding yes/' /etc/ssh/sshd_config; \
    printf '\nPasswordAuthentication yes\nUsePAM no\nAllowTcpForwarding yes\nAcceptEnv LANG LC_*\n' >> /etc/ssh/sshd_config

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D", "-e"]


