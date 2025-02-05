import cluster from 'node:cluster';
import dotenv from 'dotenv';
import express, { Express, Request, Response, NextFunction } from 'express';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

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
}