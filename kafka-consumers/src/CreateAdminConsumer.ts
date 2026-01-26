import { createClient, SanityClient } from "@sanity/client";
import { EachMessagePayload, Kafka } from "kafkajs";
import { sanityConfig } from "./utils/index.ts";
import type { AdminFieldsType } from "@declaration/AdminFieldType.d.ts";
import { createClient as redisClient } from "redis";

async function createAdmin() {
  const kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
  });

  const redisC = redisClient();
  await redisC.connect()
  const consumer = kafka.consumer({
    groupId: "admin-record",
    retry: { retries: 6 },
  });
  await consumer.connect();
  await consumer.subscribe({ topic: "admin-create-topic" });

  const sanityClient: SanityClient = createClient(sanityConfig);

  async function handleMessage({
    heartbeat,
    pause,
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    const user: AdminFieldsType = JSON.parse(message.value.toString());
    /* console.log("admin-data-received on consumer side: ", user); */

    // Create MySQL connection
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host: 'localhost',
      port: 3311,
      user: 'root',
      database: 'game_store'
    });

    if (user) {
      const adminId = `admin-${user._id}`;

      try {
        // Check if seller already exists
        const [rows] = await connection.execute('SELECT id FROM sellers WHERE id = ?', [adminId]);
        if (Array.isArray(rows) && rows.length > 0) {
          console.log(`Seller ${user.username} (ID: ${adminId}) already exists. Skipping creation.`);
          await connection.end();
          return;
        }

        await connection.execute(
          `INSERT INTO sellers 
                (id, username, email, phone, geo_lat, geo_lng, address_pincode, address_county, address_state, address_country) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                username = VALUES(username),
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
            user.email,
            user.phone || null, // Assuming phone exists on user, else null
            user.geoPoint?.lat,
            user.geoPoint?.lng,
            user.address?.pincode,
            user.address?.county,
            user.address?.state,
            user.address?.country
          ]
        );

        console.log(`<< data ${user.username} written to MySQL >>`);

        // Construct object for Redis/Log similar to what Sanity returned
        const onfulfilled = {
          _id: adminId,
          _type: 'admin',
          username: user.username,
          email: user.email,
          phone: user.phone,
          geoPoint: user.geoPoint,
          address: user.address
        };

        await connection.end();

        console.log("onfulfilled::\n", onfulfilled);

        consumer
          .commitOffsets([{ topic, offset: message.offset, partition }])
          .then(async () => {
            await heartbeat();
          });
        await redisC.hSet(`hashSet:admin:details`, onfulfilled._id, JSON.stringify(onfulfilled));
        await redisC.sAdd(`set:admin:id`, onfulfilled.username);

      } catch (err) {
        console.error("Error writing to MySQL:", err);
        // Ensure connection is closed even if there is an error
        try {
          await connection.end();
        } catch (endErr) {
          // connection might already be closed or undefined, ignore
        }
      }
    }
  }

  consumer.run({
    autoCommit: false,
    eachMessage: handleMessage,
  });
}

createAdmin()