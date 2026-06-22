module.exports = {
  apps: [
    {
      name: 'worldcup-backend',
      script: 'node_modules/ts-node-dev/lib/bin.js',
      args: '--respawn --transpile-only src/app.ts',
      interpreter: 'node',
      cwd: './backend',
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'worldcup-frontend',
      script: 'node_modules/.bin/vite',
      interpreter: 'node',
      cwd: './frontend',
      env: { NODE_ENV: 'development' },
    },
  ],
};
