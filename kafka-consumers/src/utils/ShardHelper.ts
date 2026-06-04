/**
 * ShardHelper: pincode-based deterministic shard routing.
 *
 * This is the IDEMPOTENT hash algorithm used to determine which MySQL shard
 * a store's products belong to, based on the store's pincode (postCode).
 *
 * This MUST match the logic in seller_service/src/utils/ShardHelper.ts.
 *
 * Store at pincode 123456 → hashed → shard index N (always the same)
 * All products sold by that store → stored in shard N (never scatters)
 */
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
     * Determines the database shard host based on a pincode.
     * @param pincode The store's pincode (6-character string)
     * @returns The hostname of the shard (mysql1, mysql2, etc.)
     */
    public static getShardHost(pincode: string): string {
        const index = this.getHashCode(pincode) % this.SHARD_COUNT;
        return `mysql${index + 1}`;
    }

    /**
     * Converts a shard hostname to a zero-based index for array lookups.
     * mysql1 → 0, mysql2 → 1, ..., mysql5 → 4
     */
    public static shardHostToIndex(shardHost: string): number {
        return parseInt(shardHost.replace('mysql', '')) - 1;
    }

    /**
     * Converts a pincode to a zero-based shard index.
     */
    public static getShardIndex(pincode: string): number {
        return this.shardHostToIndex(this.getShardHost(pincode));
    }
}