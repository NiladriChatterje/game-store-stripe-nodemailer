import { EachMessagePayload, Kafka } from "kafkajs";
import type { AdminFieldsType } from "@declaration/AdminFieldType.d.ts";
import { createClient as redisClient } from "redis";
import mysql from 'mysql2/promise';

async function createAdmin() {
  const kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
  });

  const redisC = redisClient({
    url: "redis://redis_storage:6379"
  });

  await redisC.connect().catch(err => console.error("Redis Connection Error:", err));

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


  const consumer = kafka.consumer({
    groupId: "admin-record",
    retry: { retries: 5 },
  });

  await consumer.connect();
  await consumer.subscribe({ topic: "admin-create-topic" });

  async function handleMessage({
    heartbeat,
    pause,
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    if (!message || !message.value) return;

    const user: AdminFieldsType = JSON.parse(message.value.toString());
    const adminId = `seller-${user._id}`;

    try {
      // Check if seller already exists
      const [rows] = await pool.execute('SELECT id FROM sellers WHERE id = ?', [adminId]);
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`Seller ${user.username} (ID: ${adminId}) already exists. Skipping creation.`);
        return;
      }

      await pool.execute(
        `INSERT INTO sellers 
              (id, username, gstin, email, phone, geo_lat, geo_lng, address_pincode, address_county, address_state, address_country) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
              username = VALUES(username),
              gstin = VALUES(gstin),
              email = VALUES(email),
              phone = VALUES(phone),
              geo_lat = VALUES(geo_lat),
              geo_lng = VALUES(geo_lng),
              address_pincode = VALUES(address_pincode),
              address_county = VALUES(address_county),
              address_state = VALUES(address_state),
              address_country = VALUES(address_country)`,
        [
          adminId,
          user.username,
          user.gstin || null,
          user.email,
          user.phone || null,
          user.geoPoint?.lat,
          user.geoPoint?.lng,
          user.address?.pincode,
          user.address?.county,
          user.address?.state,
          user.address?.country
        ]
      );

      console.log(`<< data ${user.username} written to MySQL >>`);

      const onfulfilled = {
        _id: adminId,
        _type: 'admin',
        username: user.username,
        email: user.email,
        phone: user.phone,
        geoPoint: user.geoPoint,
        address: user.address
      };

      await consumer.commitOffsets([{ topic, offset: message.offset, partition }]);
      await heartbeat();

      if (redisC.isOpen) {
        await redisC.hSet(`hashSet:admin:details`, onfulfilled._id, JSON.stringify(onfulfilled));
        await redisC.sAdd(`set:admin:id`, onfulfilled._id);
      }

    } catch (err) {
      console.error("Error in handleMessage:", err);
      throw err; // Trigger Kafka retry
    }
  }

  consumer.run({
    autoCommit: false,
    eachMessage: handleMessage,
  });
}

createAdmin().catch(console.error);
