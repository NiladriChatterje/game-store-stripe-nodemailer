import cluster from 'node:cluster';
import dotenv from 'dotenv';
import expressApp, { Express, Request, Response, NextFunction } from 'express';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import cors from 'cors'

if (cluster.isPrimary) {
    setInterval(() => {
        const child = spawn('curl', ['-X', 'GET', 'localhost:5001']);
        child.kill(0);
    }, 25000);

    let i = 0;
    while (i < availableParallelism()) {
        let child_process = cluster.fork();
        child_process.on('exit', () => {
            child_process = cluster.fork();
        })

        child_process.on('error', () => {
            child_process.kill();
            child_process = cluster.fork();
        });
        i++
    }
} else {
    const express: Express = expressApp();
    express.use(cors({
        origin: ['localhost:3000', 'localhost:5173']
    }));


    express.listen(5001, () => { console.log('add_product_by_admin : 5001') })

}