import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function verify() {
  try {
    console.log("Conectando ao Firestore...");
    const ref = doc(db, "test", "connection");
    await getDoc(ref);
    console.log("✅ Conexão com o banco de dados (Firestore) estabelecida com sucesso!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro ao conectar no Firestore:", err.message);
    process.exit(1);
  }
}
verify();
