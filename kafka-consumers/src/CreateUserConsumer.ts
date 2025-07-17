import { EachMessagePayload, Kafka, Consumer } from "kafkajs";

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
});

const consumer: Consumer = kafka.consumer({
    groupId: 'user-data-creation-consumer',
    retry: {
        restartOnFailure: async (e: Error) => Promise.resolve(true),
        retries: 15
    }
});
async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {

}
async function main() {

}