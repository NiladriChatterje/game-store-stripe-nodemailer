import mysql from 'mysql2/promise';

export interface ShardConfig {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
}

export const GLOBAL_DB_CONFIG: ShardConfig = {
    host: 'localhost',
    port: 3311, // global_sql_data
    user: 'root',
    password: '',
    database: 'xvstore'
};

export const PRODUCT_SHARDS_CONFIG: ShardConfig[] = [
    { host: 'localhost', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql1
    { host: 'localhost', port: 3307, user: 'root', password: '', database: 'xvstore' }, // mysql2
    { host: 'localhost', port: 3308, user: 'root', password: '', database: 'xvstore' }, // mysql3
    { host: 'localhost', port: 3309, user: 'root', password: '', database: 'xvstore' }, // mysql4
];

export class ShardRouter {
    private static getHashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    public static getShardIndex(productId: string): number {
        return this.getHashCode(productId) % PRODUCT_SHARDS_CONFIG.length;
    }

    public static getShardConfig(productId: string): ShardConfig {
        const index = this.getShardIndex(productId);
        return PRODUCT_SHARDS_CONFIG[index];
    }
}
