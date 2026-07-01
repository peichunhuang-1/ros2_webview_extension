FROM ros:humble AS base

ARG NODE_VERSION=20

# Install Node.js and build tools needed by rclnodejs native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates cmake pkg-config python3-pip \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Source ROS2 for interactive terminals
RUN echo "source /opt/ros/humble/setup.bash" >> /etc/bash.bashrc

WORKDIR /workspace
