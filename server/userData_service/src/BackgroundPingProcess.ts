import { spawn } from 'node:child_process'
import dotenv from 'dotenv'
dotenv.config()

let old_child_process: any[] = []
setInterval(() => {
  const child_process = spawn('curl.exe', [
    '-X',
    'GET',
    `http://localhost:${process.env.PORT}/`,
  ])

  while (old_child_process.length > 0) {
    let pop_process = old_child_process.pop()
    pop_process?.kill(0)
  }

  child_process.stdout.on('data', buffer => {
    console.log(buffer.toString('utf-8'))
    old_child_process.push(child_process)
  })
}, 60000)
