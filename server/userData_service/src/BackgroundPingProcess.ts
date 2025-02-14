import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();

setInterval(() => {
    const child_process = spawn('curl', ['-X', 'GET', `http://localhost:${process.env.PORT}/`])
    child_process.stdout.on('data', (buffer) => {
        console.log(buffer.toString('utf-8'));
    });
    child_process.kill(0)
}, 60000)
