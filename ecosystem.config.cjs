// PM2 ecosystem for Aidit OS v5 on Lenovo (Windows). Add processes here only.
module.exports = {
  apps: [
    {
      name: "aidit-v5",
      script: "ops/pm2-launch-web.cjs",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "paperclip-v5",
      script: "ops/pm2-launch-paperclip.cjs",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },
  ],
};
