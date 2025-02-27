import {type ClientConfig } from '@sanity/client';
import dotenv from 'dotenv';
dotenv.config();
export const sanityConfig : ClientConfig= {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN,
};
