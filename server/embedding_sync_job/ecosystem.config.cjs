module.exports = {
  apps: [{
    name: 'embedding_sync_job',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx',
    watch: false,
    autorestart: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
