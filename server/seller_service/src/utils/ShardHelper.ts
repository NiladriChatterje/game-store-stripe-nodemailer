import mysql from 'mysql2/promise';

export class ShardHelper {
    private static SHARD_COUNT = 5;

    private static getHashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Determines the database shard host based on an input string (e.g., state, pincode, or ID).
     * @param input The string to hash (e.g. seller's state)
     * @returns The hostname of the shard (mysql1, mysql2, etc.)
     */
    public static getShardHost(input: string): string {
        const index = this.getHashCode(input) % this.SHARD_COUNT;
        return `mysql${index + 1}`;
    }

    /**
     * Returns ALL shard hosts that have data for a given seller.
     * Uses the seller_to_shards tracking table in global_sql_data.
     * Falls back to querying all shards if the tracking table is empty for this seller.
     * @param sellerId The seller ID to look up
     * @returns Array of shard hostnames (e.g. ['mysql1', 'mysql3'])
     */
    public static async getSellerShards(sellerId: string): Promise<string[]> {
        try {
            const connection = await mysql.createConnection({
                host: 'global_sql_data',
                port: 3306,
                user: 'root',
                database: 'xvstore'
            });

            const [rows]: any = await connection.execute(
                'SELECT shard_host FROM seller_to_shards WHERE seller_id = ?',
                [sellerId]
            );
            await connection.end();

            if (Array.isArray(rows) && rows.length > 0) {
                return rows.map((r: any) => r.shard_host);
            }
        } catch (e) {
            console.warn(`Failed to fetch seller shards from tracking table for ${sellerId}:`, e);
        }

        // Fallback: return all shards if tracking table has no entries
        const allShards: string[] = [];
        for (let i = 1; i <= this.SHARD_COUNT; i++) {
            allShards.push(`mysql${i}`);
        }
        return allShards;
    }
}
