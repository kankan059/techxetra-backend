module.exports = {
  apps: [
    {
      name: 'techxetra-backend',
      script: './dist/server.js',
      instances: 'max',       // Spawns one worker per CPU core
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
