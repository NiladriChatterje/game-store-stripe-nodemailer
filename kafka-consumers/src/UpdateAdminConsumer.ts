import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { AdminFieldsType } from "@declaration/AdminFieldType";
import mysql from 'mysql2/promise';
import { createClient as RedisClient } from 'redis';

const kafka: Kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

async function updateAdminRecord() {
  const pool = mysql.createPool({
    host: 'global_sql_data',
    port: 3306,
    user: 'root',
    password: '',
    database: 'xvstore',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const redisClient = RedisClient({
    url: 'redis://redis_storage:6379'
  });
  redisClient.on('error', (err) => console.error('[UpdateAdminConsumer] Redis Client Error:', err));
  try {
    await redisClient.connect();
    console.log('[UpdateAdminConsumer] Redis client connected');
  } catch (err) {
    console.warn('[UpdateAdminConsumer] Redis connection failed — continuing without cache');
  }

  const consumer: Consumer = kafka.consumer({
    groupId: "update-admin-record",
    retry: { retries: 5 },
  });
  await consumer.connect();
  await consumer.subscribe({ topic: "admin-update-topic" });

  async function handleMessage({
    heartbeat,
    pause,
    partition,
    topic,
    message,
  }: EachMessagePayload) {
    if (!message || !message.value) return;

    const payload = JSON.parse(message.value.toString());
    console.log(`RECV: [UpdateAdminConsumer] message received on topic: ${topic}`);
    const {
      _id,
      username,
      gstin,
      address,
      email,
      phone,
    }: AdminFieldsType = payload;

    try {
      const adminId = _id.startsWith('seller-') ? _id : `seller-${_id}`;

      await pool.execute(
        `UPDATE sellers SET
          username = ?,
          gstin = ?,
          email = ?,
          phone = ?,
          address_pincode = ?,
          address_county = ?,
          address_state = ?,
          address_country = ?
          WHERE id = ?`,
        [
          username || null,
          gstin || null,
          email,
          phone ? Number(phone) : null,
          address?.pincode,
          address?.county,
          address?.state,
          address?.country,
          adminId
        ]
      );

      console.log(`<< Admin ${adminId} updated in MySQL >>`);

      // Update Redis cache so subsequent fetches return fresh data
      if (redisClient.isOpen) {
        try {
          const newData: Record<string, any> = {
            _id: adminId,
            _type: 'admin',
            username: username || null,
            gstin: gstin || null,
            email: email,
            phone: phone ? Number(phone) : null,
            ...(address ? { address } : {})
          };

          // Merge with existing Redis cache to preserve fields not sent in update payload
          // (e.g. geoPoint set by CreateAdminConsumer)
          let mergedData = newData;
          try {
            const existing = await redisClient.hGet('hashSet:admin:details', adminId);
            if (existing) {
              const parsed = JSON.parse(existing);
              mergedData = { ...parsed, ...newData };
            }
          } catch {
            // If merge fails, just use the new data
            mergedData = newData;
          }

          await redisClient.hSet('hashSet:admin:details', adminId, JSON.stringify(mergedData));
          // Ensure the admin ID is in the set of known admin IDs
          await redisClient.sAdd('set:admin:id', adminId);
          console.log(`<< Admin ${adminId} Redis cache updated >>`);
        } catch (redisErr) {
          console.warn('[UpdateAdminConsumer] Failed to update Redis cache:', redisErr);
        }
      }

      await heartbeat();
    } catch (e) {
      console.error("Error updating admin in MySQL:", e);
      throw e; // Throw to trigger Kafka retry
    }
  }

  consumer.run({ eachMessage: handleMessage });
}
updateAdminRecord().catch(console.error);
