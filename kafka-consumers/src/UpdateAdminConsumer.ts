import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { AdminFieldsType } from "@declaration/AdminFieldType";
import mysql from 'mysql2/promise';

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
      gstin,
      address,
      email,
      phone,
    }: AdminFieldsType = payload;

    try {
      const adminId = `seller-${_id}`;

      await pool.execute(
        `UPDATE sellers SET
          gstin = ?,
          email = ?,
          phone = ?,
          address_pincode = ?,
          address_county = ?,
          address_state = ?,
          address_country = ?
          WHERE id = ?`,
        [
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
      await heartbeat();
    } catch (e) {
      console.error("Error updating admin in MySQL:", e);
      throw e; // Throw to trigger Kafka retry
    }
  }

  consumer.run({ eachMessage: handleMessage });
}
updateAdminRecord().catch(console.error);
