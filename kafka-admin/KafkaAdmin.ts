import {Kafka} from 'kafkajs'

const kafka = new Kafka({
    clientId:'xv-store',
    brokers:["localhost:9092","localhost:9093","localhost:9094"],
});

async function admin(){
    const admin = kafka.admin({
        retry:{
            retries:5
        }
    });
    await admin.connect();
    try{
        console.log(await admin.listTopics())  
   
        //product topic
        admin.createTopics({
            topics:[{topic:"product-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:120000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<product-topic-creation-failed>");

        }).catch(err=>console.log("<failed! Might be created earlier>"));


        //admin-create-topic
       admin.createTopics({
            topics:[{topic:"admin-create-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<admin-topic-creation-failed>");

        }).catch(err=>console.log("<failed! Might be created earlier>"));

        //admin-update-topic
        admin.createTopics({
            topics:[{topic:"admin-update-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<product-topic-creation-failed>");
        }).catch(err=>console.log("<failed! Might be created earlier>"));


    }catch(err:Error|any){
        console.error(err?.message)
    }finally{
        await admin.disconnect()
    }
}

admin();