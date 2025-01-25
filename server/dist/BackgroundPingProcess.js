import { spawn } from 'node:child_process';
setInterval(() => {
    const child_process = spawn('curl', ['-X', 'GET', 'http://localhost:5000/']);
    child_process.stdout.on('data', (buffer) => {
        console.log(buffer.toString('utf-8'));
    });
}, 30000);
