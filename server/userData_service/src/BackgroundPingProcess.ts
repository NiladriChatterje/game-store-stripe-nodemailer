import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();

let old_child_process:any;
setInterval(() => {
    const child_process = spawn('curl.exe', ['-X', 'GET', `http://localhost:${process.env.PORT}/`]);
    if(old_child_process){
        console.log("old process killed with PID : ",old_child_process.pid)
        old_child_process?.kill(0)}
    child_process.stdout.on('data', (buffer) => {
        console.log(buffer.toString('utf-8'));
        old_child_process=child_process;
    });
  
}, 1000)
