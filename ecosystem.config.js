const path = require("path");

const port = process.env.PORT || "7790";

module.exports = {
  apps: [
    {
      name: "spacey-web",
      script: "node_modules/next/dist/bin/next",
      args: `start --hostname 127.0.0.1 --port ${port}`,
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: port,
      },
    },
  ],
};
