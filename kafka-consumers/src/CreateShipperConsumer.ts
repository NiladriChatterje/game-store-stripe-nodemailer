import { EachMessagePayload, Kafka, Consumer } from "kafkajs";
import { GLOBAL_DB_CONFIG } from "./utils/ShardRouter";
import mysql from 'mysql2/promise';

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094']
});

const pool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 10
});

import type { CreateShipperConsumerPayload as ShipperPayload } from '@declaration/ShipperType.d.ts';

async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {
    const shipperPayload: ShipperPayload = JSON.parse(message.value.toString());
    console.log("<< shipper data >> :", shipperPayload);

    // Insert shipper into MySQL (skip if already exists)
    await pool.execute(
        `INSERT IGNORE INTO shippers (id, shippername, email, phone)
         VALUES (?, ?, ?, ?)`,
        [
            shipperPayload._id,
            shipperPayload.username || shipperPayload.email.split('@')[0],
            shipperPayload.email,
            0  // placeholder phone — shipper can update via profile later
        ]
    );
    console.log("<< shipper created/ignored in MySQL >>");
}

async function main() {
    const consumer: Consumer = kafka.consumer({
        groupId: 'create-shipper-group',
        retry: {
            restartOnFailure: async (e: Error) => true,
            retries: 10
        }
    });

    await consumer.connect();
    await consumer.subscribe({
        topic: 'shipper-create-topic'
    });
    consumer.run({
        eachMessage: handleMessage
    });
    console.log("[CreateShipperConsumer] Listening on shipper-create-topic...");
}

main().catch(console.error);
