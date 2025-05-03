import cluster from "node:cluster";
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { availableParallelism } from "node:os";
import { ProductType } from "@declaration/productType";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Ollama, OllamaEmbeddings } from "@langchain/ollama";

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
  ssl: true,
});

if (cluster.isPrimary) {
  let i = 0;
  while (i < availableParallelism()) {
    cluster.fork();
    cluster.on("exit", () => {
      cluster.fork();
    });
  }
} else {
  const embeddingStore: number[] = [];
  const model = new Ollama({
    model: "mistral-ai",
    baseUrl: "http://localhost:11434",
  });

  async function main() {
    const consumer = kafka.consumer({
      groupId: "product-embedding-admin",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "product-embedding-topic" });

    async function handleEachMessages({
      heartbeat,
      message,
      partition,
      topic,
    }: EachMessagePayload) {
      console.log("<arrayBufferLike> : ", message.value);
      //embedding creation

      try {
        const productPayload: ProductType = JSON.parse(
          message.value.toString()
        );
      } catch (error: Error | any) {}
    }

    consumer.run({
      eachMessage: handleEachMessages,
      autoCommit: false,
    });
  }

  main();
}
