// Entry point for Railway deployment
// This file is used by Railpack to start the application
const { execSync } = require('child_process');

console.log('Building TypeScript...');
execSync('npm run build', { stdio: 'inherit' });

console.log('Starting server...');
execSync('npm start', { stdio: 'inherit' });
