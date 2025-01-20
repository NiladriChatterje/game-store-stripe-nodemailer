import { spawn } from 'node:child_process';
setInterval(() => {
    const child_process = spawn('curl', ['-X', 'GET', 'http://localhost:5000/']);
    child_process.stdout.on('data', (data) => {
        console.log(data.toString('utf-8'));
    });
}, 25000);
