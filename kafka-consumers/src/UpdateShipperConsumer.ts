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

import type { UpdateShipperConsumerPayload as UpdateShipperPayload } from '@declaration/ShipperType.d.ts';

async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {
    const payload: UpdateShipperPayload = JSON.parse(message.value.toString());
    console.log("[UpdateShipperConsumer] Received:", JSON.stringify(payload, null, 2));

    const { _id, shippername, phone, email, geoPoint, address } = payload;

    if (!_id) {
        console.error("[UpdateShipperConsumer] Missing _id in payload — skipping");
        return;
    }

    // Build dynamic UPDATE query (only set fields that are provided)
    const updateFields: string[] = [];
    const params: any[] = [];

    if (shippername !== undefined) {
        updateFields.push('shippername = ?');
        params.push(shippername);
    }
    if (phone !== undefined) {
        updateFields.push('phone = ?');
        params.push(phone);
    }
    if (email !== undefined) {
        updateFields.push('email = ?');
        params.push(email);
    }
    if (geoPoint?.lat !== undefined) {
        updateFields.push('geo_lat = ?');
        params.push(geoPoint.lat);
    }
    if (geoPoint?.lng !== undefined) {
        updateFields.push('geo_lng = ?');
        params.push(geoPoint.lng);
    }
    if (address?.pincode !== undefined) {
        updateFields.push('address_pincode = ?');
        params.push(address.pincode);
    }
    if (address?.county !== undefined) {
        updateFields.push('address_county = ?');
        params.push(address.county);
    }
    if (address?.country !== undefined) {
        updateFields.push('address_country = ?');
        params.push(address.country);
    }
    if (address?.state !== undefined) {
        updateFields.push('address_state = ?');
        params.push(address.state);
    }

    if (updateFields.length === 0) {
        console.warn("[UpdateShipperConsumer] No fields to update — skipping");
        return;
    }

    params.push(_id);

    try {
        await pool.execute(
            `UPDATE shippers SET ${updateFields.join(', ')} WHERE id = ?`,
            params
        );
        console.log(`[UpdateShipperConsumer] Shipper ${_id} updated successfully`);
    } catch (err: any) {
        console.error(`[UpdateShipperConsumer] Error updating shipper ${_id}:`, err.message);
    }
}

async function main() {
    const consumer: Consumer = kafka.consumer({
        groupId: 'update-shipper-group',
        retry: {
            restartOnFailure: async (e: Error) => true,
            retries: 10
        }
    });

    await consumer.connect();
    await consumer.subscribe({
        topic: 'shipper-update-topic'
    });
    consumer.run({
        eachMessage: handleMessage
    });
    console.log("[UpdateShipperConsumer] Listening on shipper-update-topic...");
}

main().catch(console.error);
