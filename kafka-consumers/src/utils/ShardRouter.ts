import mysql from 'mysql2/promise';

export interface ShardConfig {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
}

export const GLOBAL_DB_CONFIG: ShardConfig = {
    host: 'global_sql_data',
    port: 3306, // global_sql_data
    user: 'root',
    password: '',
    database: 'xvstore'
};

export const PRODUCT_SHARDS_CONFIG: ShardConfig[] = [
    { host: 'mysql1', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql1
    { host: 'mysql2', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql2
    { host: 'mysql3', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql3
    { host: 'mysql4', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql4
    { host: 'mysql5', port: 3306, user: 'root', password: '', database: 'xvstore' }, // mysql5
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
